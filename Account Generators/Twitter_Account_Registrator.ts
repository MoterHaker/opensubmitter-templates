/// <reference path="type.d.ts" />
const fs = require("fs")

interface TwitterTemplateTask extends TemplateTask {
    data: {
        name: string            // User name generated by getRandomName method
        surname: string         // Surname generated by getRandomName method
        username: string        // Username generated by getRandomName method
        password: string        // Password generated by getRandomName method
        proxyServer: string     // Proxy credentials provided by user
        proxyPort: string
        proxyLogin?: string     // Optional proxy login and password
        proxyPassword?: string
        imapServer: string      //IMAP email details provided by the user
        imapPort: number
        email: string
        emailLogin: string
        emailPassword: string
        outputFile: string
    }
}

class Template implements OpenSubmitterTemplateProtocol {

    config: TemplateConfig = {

        // Name and description to display in OpenSubmitter's UI:
        name: 'Twitter Account Registrator',
        description: 'Registers accounts with email confirmation. Requires list of emails and IMAP server credentials, as well as proxies. Output is a JSON file with twitter name, email, twitter password, used proxies and collected cookies.',

        // Based on this setting, OpenSubmitter will inject Puppeteer's page object into this template
        capabilities: ['puppeteer'],

        // This tells OpenSubmitter that the user is allowed to specify amount of threads:
        multiThreadingEnabled: true,

        // User's settings for OpenSubmitter UI:
        userSettings: [
            {
                type: 'Textarea',
                name: 'emails',
                title: 'IMAP accounts list, one per line. Format: imapserver:port:email:login:password',
                placeholder: 'imap.gmail.com:993:mymail@gmail.com:mymail@gmail.com:password123',
                required: false
            },{
                type: 'Textarea',
                name: 'proxies',
                title: 'Proxy list, one per line. Format: server;port;login;password',
                placeholder: '12.34.34.56:3128:login:password',
                required: false
            },{
                type: 'OutputFile',
                name: 'outputFile',
                title: 'Where to write the list of accounts in JSON format',
                fileName: "",
                required: true,
                uiWidth: 100
            },
        ],

        resultTableHeader: [
            {
                title: 'Email'
            },{
                title: 'Name'
            },{
                title: 'Password'
            },{
                title: 'Cookies'
            },{
                title: 'Error'
            },{
                title: 'Result',
                isResult: true
            }
        ],

        email: 'dev@captcha.pub',
        rewardTronAddress: 'TGVF1UKmU2iJToW3Lv3pJ3VqrdT2Bq7yvq',
        icon: 'https://c0.lestechnophiles.com/c.clc2l.com/c/thumbnail256webp/t/t/w/twitter-MAWXNC.png'
    };

    // Dummy variable, will be overridden by OpenSubmitter with Puppeteer's page object
    page = null;
    task: TwitterTemplateTask | null = null;

    async generateTasks(...args: any): Promise<TemplateTask[]> {

        const emailList = this.config.userSettings.find(setting => setting.name === 'emails').value.toString().split("\n");
        const proxyList = this.config.userSettings.find(setting => setting.name === 'proxies').value.toString().split("\n");
        const outputFile = this.config.userSettings.find(setting => setting.name === 'outputFile').fileName;

        if (emailList.length === 0) {
            this.log('Empty list of emails');
            return [];
        }
        if (proxyList.length === 0) {
            this.log('Empty list of proxies');
            return [];
        }

        const proxies = [];
        for (const proxyRow of proxyList) {
            const proxySplit = proxyRow.split(":");
            if (proxySplit.length == 2) {
                let [proxyServer, proxyPort] = proxySplit;
                proxies.push({
                    proxyServer,
                    proxyPort
                })
            }
            if (proxySplit.length == 4) {
                let [proxyServer, proxyPort, proxyLogin, proxyPassword] = proxySplit;
                proxies.push({
                    proxyServer,
                    proxyPort,
                    proxyLogin,
                    proxyPassword
                })
            }
        }

        if (proxies.length === 0) {
            this.log('Empty list of valid proxies');
            return [];
        }

        const result: TemplateTask[] = [];

        for (const emailRow of emailList) {
            const emailSplit = emailRow.split(":");
            if (emailSplit.length !== 5) continue;
            const [imapServer, imapPortStr, email, emailLogin, emailPassword] = emailSplit;
            const imapPort = parseInt(imapPortStr)

            const randomProxy = proxies[Math.floor(Math.random() * proxies.length)]

            const randomPerson = this.getRandomName({
                randomGender: true,
                minimumUsernameLength: 10,
                usernameWithANumber: true
            })

            result.push({
                data: {
                    ...randomProxy,
                    imapServer,
                    imapPort,
                    email,
                    emailLogin,
                    emailPassword,
                    ...randomPerson,
                    outputFile
                } as TwitterTemplateTask
            });
        }

        return result;

    }

    async runTask(task: TwitterTemplateTask) {
        // upper layer to registration task to catch all Puppeteer exceptions
        // and post them nicely to results table in UI
        try {
            return await this.registerAccount(task);
        } catch (e) {
            this.postFailedStatus(task, e.toString());
            return;
        }
    }


    async registerAccount(task: TwitterTemplateTask) {

        console.log('task: ', task);

        // Setting proxy authorization if credentials are provided
        if (task.data.proxyLogin && task.data.proxyPassword) {
            this.log(`setting proxy authentication ${task.data.proxyLogin}:${task.data.proxyPassword}`);
            await this.page.authenticate({
                username: task.data.proxyLogin,
                password: task.data.proxyPassword,
            });
        }

        try {
            this.log(`navigating to https://twitter.com...`);
            await this.page.goto("https://twitter.com", {
                waitUntil: "networkidle0",
                timeout: 60000
            });
        } catch (e) {
            this.postFailedStatus(task, 'Page error: ' + e);
            return;
        }

        // Clicking button "accept cookies" if exists
        try {
            const [el] = await this.page.$x('//span[text()="Accept all cookies"]');
            await el?.click();
        } catch (e) {
            this.log("Could not find \"Accept all cookies\"button");
        }


        this.log('clicking "Create account"');
        const [el] = await this.page.$x('//span[text()="Create account"]');
        await el?.click();

        await new Promise(async (resolve, reject) => {
            while (true) {
                let useEmailLink = await this.page.$x('//span[text()="Use email instead"]');
                if (useEmailLink.length === 0) {
                    this.log('Link not appeared yet');
                    await this.delay(1000);
                } else {
                    this.log('Clicking "Use email instead" link');
                    await useEmailLink[0].click();
                    resolve(true);
                    return;
                }

                // We may have already been redirected to email form, checking if input is there
                if (await this.page.$('input[name="name"]')) {
                    this.log("Email input is already there")
                    resolve(true);
                    return;
                }

            }
        });

        this.log('filling name');
        await this.page.type('input[name="name"]', task.data.name);

        this.log('filling email');
        await this.page.type('input[name="email"]', task.data.email);

        this.log('filling birth date');
        await this.page.$eval('#SELECTOR_1', (element) => {
            element.value = (Math.floor(Math.random() * 11) + 1).toString();
            const event = new Event('change', { bubbles: true });
            element.dispatchEvent(event);
        });
        await this.page.$eval('#SELECTOR_2', (element) => {
            element.value = (Math.floor(Math.random() * 11) + 1).toString();
            const event = new Event('change', { bubbles: true });
            element.dispatchEvent(event);
        });
        await this.page.$eval('#SELECTOR_3', (element) => {
            element.value = (Math.floor(Math.random() * 20) + 1980).toString();
            const event = new Event('change', { bubbles: true });
            element.dispatchEvent(event);
        });
        await this.delay(1000);

        this.log('clicking next');
        let nextEl1 = await this.page.$x('//span[text()="Next"]');
        await nextEl1[0].click();

        await this.delay(2000);
        this.log('clicking next one more time');
        let nextEl2 = await this.page.$x('//span[text()="Next"]');
        await nextEl2[0].click();

        await this.delay(2000);
        this.log('clicking Sign Up');
        let nextEl3 = await this.page.$x('//*[@id="layers"]/div[2]/div/div/div/div/div/div[2]/div[2]/div/div/div[2]/div[2]/div[2]/div/div/div[2]/div/div');
        await nextEl3[0].click();


        this.log('solving Funcaptcha with Anti-Captcha');
        const token = await this.solveCaptcha({
            type: 'FunCaptcha',
            websiteURL: 'https://twitter.com',
            websiteKey: '2CB16598-CB82-4CF7-B332-5990DB66F3AB'
        })

        this.log('emitting Funcaptcha challenge-complete event with token '+token);
        await this.page.evaluate(async (token) => {
            window.postMessage(JSON.stringify({
                eventId: "challenge-complete",
                publicKey: "2CB16598-CB82-4CF7-B332-5990DB66F3AB",
                payload: {
                    sessionToken: token
                }
            }), "*")
        }, token);

        this.log('waiting for 5 seconds to allow email to arrive');
        await this.delay(5000);

        // Checking if confirmation code input is in place
        if (! await this.page.$('input[name="verfication_code"]')) {
            this.postFailedStatus(task, "incorrect captcha token")
            return;
        }

        let confirmationCode = null;

        try {
            // querying IMAP server in a promise for better control of 2-level loops
            await new Promise(async(resolve, reject) => {
                for (let waitTime = 0; waitTime < 60; waitTime++) {

                    this.log("querying IMAP server for confirmation code");
                    const messages = await this.getIMAPMessages({
                        host: task.data.imapServer,
                        port: task.data.imapPort,
                        user: task.data.emailLogin,
                        password: task.data.emailPassword,
                        tls: true,
                        tlsOptions: { rejectUnauthorized: false },
                        authTimeout: 10000
                    });

                    this.log(`got ${messages.length} IMAP messages`)
                    for (const message of messages) {
                        if (message.subject.indexOf('verification code') !== -1) {

                            // getting code from the subject
                            confirmationCode = parseInt(message.subject.replace(' is your Twitter verification code', '').replaceAll(' ','').trim()).toString();
                            this.log(`got confirmation code: ${confirmationCode}`)

                            await this.deleteIMAPMessage(message.UID);
                            this.log(`removed message from IMAP server`);

                            await this.page.type('input[name="verfication_code"]', confirmationCode);
                            await this.page.$eval('input[name="verfication_code"]', (element) => {
                                const event = new Event('change', { bubbles: true });
                                element.dispatchEvent(event);
                            });

                            await this.delay(2000);
                            console.log('clicking next to confirm the code');
                            let confirmNext = await this.page.$x('//span[text()="Next"]');
                            if (confirmNext.length) {
                                await confirmNext[0].click();
                            } else {
                                reject("no Next link found :( after entering confirmation code");
                                return;
                            }

                            await this.delay(5000);
                            if (! await this.page.$('input[name="verfication_code"]')) {
                                this.log('continuing to profile');
                                resolve(true);
                                return;
                            } else {
                                this.log("retrying confirmation code in 30 sec");
                                await this.delay(30000);
                            }
                        }
                    }

                    // Close to prevent IMAP server limitations errors
                    await this.closeIMAPConnection();
                }

                if (!confirmationCode) {
                    reject("Waited too long for the confirmation code");
                    return;
                }
            })
        } catch (e) {
            this.postFailedStatus(task, e.toString());
            return;
        }


        await this.page.waitForSelector('input[name="password"]', {timeout: 120000});

        await this.page.type('input[name="password"]', task.data.password);
        await this.delay(2000);

        this.log('clicking through profile setup buttons')
        while (true) {
            let nextEl = await this.page.$x('//span[text()="Next"]');
            let skipForNowEl = await this.page.$x('//span[text()="Skip for now"]');
            if (nextEl.length) {
                this.log('clicking next');
                await nextEl[0].click();
                await this.delay(1500);
            } else if (skipForNowEl.length) {
                this.log('clicking skip for now');
                await skipForNowEl[0].click();
                await this.delay(1500);
            } else {
                this.log('nothing else to click');
                break;
            }
        }

        const cookies = await this.page.cookies();

        this.log('successfully registered the account');
        this.postResultToTable({
            'Email': task.data.email,
            'Name': task.data.name,
            'Password': task.data.password,
            'Cookies': JSON.stringify(cookies),
            'Error': '',
            'Result': true
        });
        this.appendResultToFile(cookies);
        await this.delay(2000);

    }

    appendResultToFile(cookies: object) {
        const fileName = this.task.data.outputFile;
        let existingJSON = [];
        if (fs.existsSync(fileName)) {
            try {
                existingJSON = JSON.parse(fs.readFileSync(fileName).toString());
            } catch (e) {
                existingJSON = [];
            }
        }
        existingJSON.push({
            'Email': this.task.data.email,
            'Name': this.task.data.name,
            'Password': this.task.data.password,
            'proxyServer': this.task.data.proxyServer,
            'proxyPort': this.task.data.proxyPort,
            'proxyLogin': this.task.data.proxyLogin,
            'proxyPassword': this.task.data.proxyPassword,
            'cookies': cookies
        })
        fs.writeFileSync(fileName, JSON.stringify(existingJSON, null, 4));
    }

    postFailedStatus(task: TemplateTask, message: string) {
        this.log(message);
        this.postResultToTable({
            'Email': task.data.email,
            'Name': task.data.name,
            'Password': task.data.password,
            'Cookies': '',
            'Error': message,
            'Result': false
        })
    }

    // Returns custom Chromium arguments
    // This is a place to tune Chromium instance
    getPuppeteerArguments(): string[] {

        // this.task is already pre-filled in inheriting controller (templateController.ts, method startTask)
        return [
            `--proxy-server=${this.task.data.proxyServer}:${this.task.data.proxyPort}`,
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--allow-running-insecure-content',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--mute-audio',
            '--no-zygote',
            '--no-xshm',
            '--window-size=1920,1080',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--enable-webgl',
            '--ignore-certificate-errors',
            '--lang=en-US,en;q=0.9',
            '--password-store=basic',
            '--disable-gpu-sandbox',
            '--disable-software-rasterizer',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-infobars',
            '--disable-breakpad',
            '--disable-canvas-aa',
            '--disable-2d-canvas-clip-aa',
            '--disable-gl-drawing-for-tests',
            '--enable-low-end-device-mode',
            '--no-sandbox'
        ]
    }

    delay(time) {
        return new Promise(function(resolve) {
            setTimeout(resolve, time)
        });
    }

    // will be overridden by Template Controller
    postResultToTable(result: object) {

    }

    // will be overridden by Template Controller
    async deleteIMAPMessage(uid: number): Promise<void> {

    }

    // will be overridden by Template Controller
    async getIMAPMessages(config: IMAPConfig): Promise<any[]> {
        return []
    }

    async closeIMAPConnection(): Promise<void> {
        return
    }

    // will be overridden by Template Controller
    async solveCaptcha(captcha: Captcha): Promise<string | object> {
        return "";
    }

    // will be overridden by Template Controller
    log(msg: string) {
        console.log(msg);
    }

    // will be overridden by Template Controller
    getRandomName(requirements: GeneratedPersonRequirements): GeneratedPerson {
        return {
            name: '',
            surname: '',
            username: '',
            password: ''
        }
    }

}