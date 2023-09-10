/// <reference path="type.d.ts" />
const fs = require("fs");

class Template implements OpenSubmitterTemplateProtocol {
    config: TemplateConfig = {
        // Name and description to display in OpenSubmitter's UI:
        name: "Youtube Comment Exporter",
        description: "This template extracts Youtube comments of a given video URLs into CSV, SQL, JSON or MongoDB file",

        // Based on this setting, OpenSubmitter will inject Puppeteer's page object into this template
        capabilities: ["puppeteer"],

        // This tells OpenSubmitter that the user is allowed to specify amount of threads:
        multiThreadingEnabled: true,

        // User's settings for OpenSubmitter UI:
        userSettings: [
            {
                type: "Textarea",
                name: "links",
                title: "Youtube video websites list, one per line",
                placeholder: "https://www.youtube.com",
                required: true,
            },
            {
                type: "Textarea",
                name: "proxies",
                title: "Proxy list, one per line. Format: host:port:login:password",
                placeholder: "12.34.34.56:3128:login:password",
                required: false,
            },
            {
                type: "TextInput",
                name: "textvalue1",
                placeholder: "Enter the number of comments you want to collect",
                title: "No of comments",
                value: "1000",
                required: false,
                uiWidth: 50,
            },
            {
                type: "ExportFile",
                name: "outputFile",
                title: "Where to write youtube Comments",
                value: "CSV",
                fileName: "",
                required: true,
                uiWidth: 100,
            },
        ],

        resultTableHeader: [
            {
                title: "Youtube Link",
            },
            {
                title: "Comments count",
            },
            {
                title: "Result",
                isResult: true,
            },
        ],

        icon: 'https://img.freepik.com/premium-vector/youtube-logo-circle-red-social-media-logo_197792-4982.jpg',

        email: "dev@opensubmitter.com",
    };
    // Dummy variable, will be overridden by OpenSubmitter with Puppeteer's page object
    page = null;

    async generateTasks(...args: any): Promise<TemplateTask[]> {
        const links = this.config.userSettings
            .find((setting) => setting.name === "links")
            .value.toString()
            .split("\n");

        let proxyList;
        if (
            this.config.userSettings.find((setting) => setting.name === "proxies")
                ?.value !== undefined
        ) {
            proxyList = this.config.userSettings
                .find((setting) => setting.name === "proxies")
                .value.toString()
                .split("\n");
        }

        const noOfComments = parseInt(
            this.config.userSettings
                .find((setting) => setting.name === "textvalue1")
                .value.toString()
        );

        const fileName = this.config.userSettings.find(
            (setting) => setting.name === "outputFile"
        ).fileName;

        if (links.length === 0) {
            this.log("Please enter at least one link");
            return [];
        }

        const proxies = [];
        let randomProxy;

        if (proxyList) {
            for (const proxyRow of proxyList) {
                const proxySplit = proxyRow.split(":");
                if (proxySplit.length == 2) {
                    let [proxyServer, proxyPort] = proxySplit;
                    proxies.push({
                        proxyServer,
                        proxyPort,
                    });
                }
                if (proxySplit.length == 4) {
                    let [proxyServer, proxyPort, proxyLogin, proxyPassword] = proxySplit;
                    proxies.push({
                        proxyServer,
                        proxyPort,
                        proxyLogin,
                        proxyPassword,
                    });
                }
            }
        }

        randomProxy = proxyList
            ? proxies[Math.floor(Math.random() * proxies.length)]
            : "";

        const result: TemplateTask[] = [];

        for (const link of links) {
            result.push({
                data: {
                    url: link,
                    noOfComments,
                    randomProxy,
                    fileName,
                },
            });
        }

        return result;
    }

    async runTask(task: TemplateTask) {
        try {
            //  Setting proxy authorization if credentials are provided
            if (task.data.proxyLogin && task.data.proxyPassword) {
                this.log(
                    `setting proxy authentication ${task.data.proxyLogin}:${task.data.proxyPassword}`
                );
                await this.page.authenticate({
                    username: task.data.proxyLogin,
                    password: task.data.proxyPassword,
                });
            }

            console.log('version 3');
            this.log(`navigating to ${task.data.url}...`);
            await this.page.goto(task.data.url, {
                waitUntil: "networkidle0",
            });

            await this.delay(3000);
            await this.page.evaluate(() => {
                window.scrollTo(0, 10000);
            });
            await this.delay(1000);

            this.log("Scrolling to comments");
            await this.page.evaluate(() => {
                const element = document.querySelector("#comments"); // Replace with your target element selector
                if (element) {
                    element.scrollIntoView({ behavior: "smooth", block: "center" });
                }
            });

            await this.page.waitForSelector(
                "#count > yt-formatted-string > span:nth-child(1)"
            );

            const commentNoSelector = await this.page.evaluate(() => {
                return document.querySelector("#count > yt-formatted-string > span:nth-child(1)").textContent;
            });

            console.log('commentNoSelector', commentNoSelector);

            const commentNo = parseInt(commentNoSelector);

            await this.page.waitForSelector("#content-text");

            let height = 0;
            let comment: Array<String> = [];
            let lastCommentCount = 0;
            let commentAmountIsSame = 0;

            this.log("Collecting comments");

            for (let i = 0; comment.length < task.data.noOfComments; i++) {
                await this.page.evaluate((height) => {
                    window.scrollTo(0, height);
                }, height);
                height += 10000;

                await this.page.waitForSelector("#content-text");

                await this.delay(2000);

                const commentResult = await this.page.evaluate(() => {
                    const result = [...document.querySelectorAll("#content-text")];
                    return result.map((comment) => comment.innerText);
                });

                comment = commentResult;


                this.log(`Collected ${commentResult.length} comments so far`);

                if (comment.length !== lastCommentCount) {
                    lastCommentCount = comment.length;
                    commentAmountIsSame = 0;
                } else {
                    commentAmountIsSame ++;
                }

                if (comment.length + 1 === commentNo || commentAmountIsSame >= 3) {
                    break;
                }
            }


            const comments: Array<String> = comment
                .slice(0, task.data.noOfComments)

            this.log("Comments successfully extracted");

            this.postResultToTable({
                "Youtube Link": task.data.url,
                "Comments count": comments.length,
                Result: true,
            });

            for (const comm of comments) {
                await this.postResultToStorage({
                    fields: ["link", "comment"],
                    values: {
                        link: task.data.url,
                        comment: comm,
                    },
                });
            }

        } catch (error) {
            this.log(
                "could not scrape comments " + task.data.url + ": " + error.toString()
            );

            // post to results table in UI
            this.postResultToTable({
                "Youtube Link": task.data.url,
                "Comments count": 0,
                Result: false,
            });
        }
    }

    delay(time) {
        return new Promise(function (resolve) {
            setTimeout(resolve, time);
        });
    }

    checkProxy() {
        if (
            this.config.userSettings.find((setting) => setting.name === "proxies")
                ?.value !== undefined
        ) {
            return `--proxy-server=${this.task.data.proxyServer}:${this.task.data.proxyPort}`;
        }
        return "";
    }
    // Returns custom Chromium arguments
    // This is a place to tune Chromium instance
    getPuppeteerArguments(): string[] {
        // this.task is already pre-filled in inheriting controller (templateController.ts, method startTask)
        return [
            this.checkProxy(),
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
            "--allow-running-insecure-content",
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--mute-audio",
            "--no-zygote",
            "--no-xshm",
            "--window-size=1920,1080",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--enable-webgl",
            "--ignore-certificate-errors",
            "--lang=en-US,en;q=0.9",
            "--password-store=basic",
            "--disable-gpu-sandbox",
            "--disable-software-rasterizer",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-infobars",
            "--disable-breakpad",
            "--disable-canvas-aa",
            "--disable-2d-canvas-clip-aa",
            "--disable-gl-drawing-for-tests",
            "--enable-low-end-device-mode",
            "--no-sandbox",
        ];
    }

    // will be overridden by Template Controller
    postResultToTable(result: object) {}

    // keep empty, will be replaced by Template Controller
    postResultToStorage(result: TemplateResult) {}

    // will be overridden by Template Controller
    async solveCaptcha(captcha: Captcha): Promise<string | object> {
        return "";
    }

    // will be overridden by Template Controller
    log(msg: string) {
        console.log(msg);
    }
}