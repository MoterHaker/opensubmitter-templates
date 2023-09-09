/// <reference path="../templates/type.d.ts" />

const fs = require("fs")
const os = require("os");
const path = require("path");

interface SearchResult {
    position: number;
    url: string;
    textSnippet: string;
    anchorLink: string;
}

interface SearchSuggestion {
    suggestion: string;
    url: string;
}

interface SerpResult {
    keyword: string;
    relatedKeywords: SearchSuggestion[];
    amountOfResults: number;
    searchResults: SearchResult[];
}

interface SearchDepth {
    searchDepthValue: number;
    searchSuggestions: SearchSuggestion[];
}

interface Proxy {
    proxyServer: string;
    proxyPort: string;
    proxyLogin?: string;
    proxyPassword?: string;
}

class Template implements OpenSubmitterTemplateProtocol {

    config: TemplateConfig = {

        // Name and description to display in OpenSubmitter's UI:
        name: 'Ya.ru SERP Parser',
        description: `Open ya.ru and based on provided keywords, collect data (urls, link anchors, text snippets, position numbers, list of related keywords)
        with puppeteer-chromium in headless mode and write the results in a single file output file. Bypass click-captcha if met by taking it's screenshots, sending to Anti-Captcha and clicking on resulting points.`,

        // Based on this setting, OpenSubmitter will inject Puppeteer's page object into this template
        capabilities: ['puppeteer'],

        // This tells OpenSubmitter that the user is allowed to specify amount of threads:
        multiThreadingEnabled: true,

        // User's settings for OpenSubmitter UI:
        userSettings: [
            {
                type: 'Textarea',
                name: 'keywords',
                title: 'Keywords list, one per line',
                value: '',
                required: true,
                uiWidth: 100,
            },
            {
                type: 'Checkbox',
                name: 'alsoSearchedFor',
                title: 'Recursive search via "People also searched for"',
                value: false,
                uiWidth: 100,
            },
            {
                type: 'TextInput',
                name: 'searchDepth',
                title: 'Depth or recursive search',
                uiWidth: 50
            },
            {
                type: 'TextInput',
                name: 'pageNumber',
                title: 'How many pages to search through',
                uiWidth: 50
            },
            {
                type: 'SourceFile',
                name: 'proxySourceFile',
                title: 'Proxy List, in host:port:login:password format',
                fileName: '',
                required: false,
                uiWidth: 100
            },
            {
                // A text input with a button which opens "create a file" dialog
                type: 'ExportFile',
                name: 'outputFile',
                title: 'Where to write the output of the download',
                fileName: "",
                required: true,
                uiWidth: 100
            },
            
        ],

        resultTableHeader: [
            {
                title: 'Keyword'
            },
            {
                title: 'Amount of results'
            },
            {
                title: 'Amount of links collected'
            },
            {
                title: 'Job result',
                isResult: true
            }
        ],

        email: 'dev@opensubmitter.com'
    };

    // Dummy variable, will be overridden by OpenSubmitter with Puppeteer's page object
    page = null;
    task: TemplateTask;


    url = 'https://ya.ru'
    existingResults: SerpResult[] = [];
    serpResult: SerpResult | null = null;

    serpResults: SerpResult[] = [];
    searchDepth: SearchDepth[] = [];

    async generateTasks(...args: any): Promise<TemplateTask[]> {
        const keywordsValue = this.config.userSettings.find(setting => setting.name === 'keywords')?.value;

        const keywordsList = keywordsValue?.toString().split("\n")

        const alsoSearchedForValue = this.config.userSettings.find(setting => setting.name === 'alsoSearchedFor')?.value;

        const searchDepthValue = this.config.userSettings.find(setting => setting.name === 'searchDepth')?.value;

        const pageNumberValue = this.config.userSettings.find(setting => setting.name === 'pageNumber')?.value;

        const proxySourceFileName = this.config.userSettings.find(setting => setting.name === 'proxySourceFile')?.fileName;

        const proxyList: string[] = proxySourceFileName ? fs.readFileSync(proxySourceFileName, 'utf8').split("\n") : null;

        const proxies: Proxy[] = [];

        if (proxyList && proxyList.length > 0) {

            for (const proxyRow of proxyList) {

                const proxySplit = proxyRow.split(':');

                if (proxySplit.length === 2) {
                    const [proxyServer, proxyPort] = proxySplit;
                    proxies.push({
                        proxyServer,
                        proxyPort
                    });
                }

                if (proxySplit.length === 4) {
                    const [proxyServer, proxyPort, proxyLogin, proxyPassword] = proxySplit;
                    proxies.push({
                        proxyServer,
                        proxyPort,
                        proxyLogin,
                        proxyPassword
                    });

                }
            }
        }

        const outputFormatValue = this.config.userSettings.find(setting => setting.name === 'outputFormat')?.value;

        const fileName = this.config.userSettings.find(setting => setting.name === 'outputFile')?.fileName;

        const result: TemplateTask[] = keywordsList ?
            keywordsList?.map(keyword => {
                this.log('adding keyword '+keyword);
                const randomProxy: Proxy = proxies.length > 0 ?
                    proxies[Math.floor(Math.random() * proxies.length)] :
                    { proxyServer: '', proxyPort: '', proxyLogin: '', proxyPassword: '' };

                return {
                    data: {
                        keyword,
                        alsoSearchedForValue,
                        searchDepthValue,
                        pageNumberValue,
                        ...randomProxy,
                        outputFormatValue,
                        fileName
                    }
                }
            }) : [];

        return result;
    }


    async runTask(task: TemplateTask) {

        this.task = task;

        this.existingResults = [];
        this.serpResult = this.initSerpResult(task.data.keyword);

        this.serpResults = [];
        this.searchDepth = [];



        await this.defaultNavigationAndSearch();

        const suggestions = await this.collectSearchSuggestions.call(this, task.data.keyword)

        this.searchDepth.push({
            searchDepthValue: 0,
            searchSuggestions: suggestions
        });

        this.postResultToStorage({
            fields: ['keyword', 'suggestions'],
            values: {
                'keyword':      task.data.keyword,
                'suggestions':  suggestions
            }
        })

        await this.collectResults(task.data.keyword);

        if (task.data.alsoSearchedForValue && task.data.searchDepthValue > 0 && task.data.searchDepthValue < 5) {
            await this.collectResultsByDepth.call(this, 1, task.data.searchDepthValue);
        }
    }


    initSerpResult(keyword: string): SerpResult {
        return {
            keyword: keyword,
            relatedKeywords: [],
            amountOfResults: 0,
            searchResults: []
        };
    }

    async defaultNavigationAndSearch(): Promise<void> {

        console.log('running version 004')

        // Setting proxy authorization if credentials are provided
        if (this.task.data.proxyLogin && this.task.data.proxyPassword) {
            this.log(`setting proxy authentication ${this.task.data.proxyLogin}:${this.task.data.proxyPassword}`);
            await this.page.authenticate({
                username: this.task.data.proxyLogin,
                password: this.task.data.proxyPassword,
            });
        }

        try {
            this.log(`navigating to ${this.url}...`);
            await this.page.goto(this.url, {
                waitUntil: "networkidle0",
                timeout: 20000
            });
        } catch (e) {
            console.log(e);
            this.log('err while loading the page: ' + e);
            this.postResultToTable({
                'Keyword': this.task.data.keyword,
                'Amount of results': 0,
                'Amount of links collected': 0,
                'Job result': false
            });
        }

        await this.checkForCaptcha();


        try {
            this.log(`search for "${this.task.data.keyword}" keyword`);
            await this.page.waitForSelector('#text');
            await this.page.type('#text', this.task.data.keyword);

            await this.page.keyboard.press('Enter');
            await this.page.waitForNavigation();

        } catch (e) {
            console.log(e);
            this.log('err while searching for the keyword: ' + e);
            this.postResultToTable({
                'Keyword': this.task.data.keyword,
                'Amount of results': 0,
                'Amount of links collected': 0,
                'Job result': false
            });
        }
    }

    async checkForCaptcha(): Promise<void> {
        this.log("we are at URL "+this.page.url())
        if (this.page.url().indexOf('/showcaptcha') === -1) return;

        this.log('solving captcha');

        if (! await this.page.$('div.AdvancedCaptcha-Footer')) {

            await this.page.waitForSelector('div.CheckboxCaptcha-Anchor > div');
            await this.page.click("div.CheckboxCaptcha-Anchor > div");

            await this.page.waitForNavigation();

        }

        const cookieSuggestion = await this.page.$("div.gdpr-popup-v3-button.gdpr-popup-v3-button_id_all")
        if (cookieSuggestion) {
            this.log("clicking accept all cookies");
            await this.page.click("div.gdpr-popup-v3-button.gdpr-popup-v3-button_id_all");
        }

        // hiding elements to make captcha look nicely:
        await this.page.evaluate(() => {
            const elements = document.querySelectorAll("#advanced-captcha-form > div > div.AdvancedCaptcha-FormActions");
            for(let i=0; i< elements.length; i++){
                elements[i].setAttribute("style", "display:none");
            }
        })
        await this.delay(500);

        const element = await this.page.$("#advanced-captcha-form > div");
        const randomPath = path.join(os.tmpdir(), "yacaptcha"+Math.floor(Math.random()*100)+".png");

        if (element) {
            this.log('screenshotting captcha to '+randomPath);
            await element.screenshot({
                path: randomPath
            });
        } else {
            console.log('could not find element to screenshot');
            throw new Error("could not screenshot captcha");
        }

        // showing elements again
        await this.page.evaluate(() => {
            const elements = document.querySelectorAll("#advanced-captcha-form > div > div.AdvancedCaptcha-FormActions");
            for(let i=0; i< elements.length; i++){
                elements[i].setAttribute("style", "display: auto");
            }
        })

        this.log("waiting for captcha result");
        const coordinates = await this.solveCaptcha({
            type: 'ImageToCoordinates',
            imageBodyBase64: fs.readFileSync(randomPath, { encoding: 'base64' }),
            extraParameters: {
                coordinatesMode: "points",
                comment: "Select objects in the specified order"
            }
        })

        this.log('submitting captcha');
        // const coordinates = [ [ 68, 130 ], [ 223, 106 ], [ 69, 38 ], [ 173, 36 ], [ 258, 40 ] ]
        console.log('coordinates:', coordinates);
        for (const coordinate of (coordinates as object[])) {
            const element = await this.page.$('div.AdvancedCaptcha-View');

            // Get the bounding box of the captcha
            const boundingBox = await element.boundingBox();

            // Calculate the absolute coordinates for the click
            const x = boundingBox.x + coordinate[0];
            const y = boundingBox.y + coordinate[1];

            await this.delay(Math.random()*400+100);

            // Click at the calculated coordinates
            await this.page.mouse.click(x, y);
        }
        await this.delay(1000);

        await this.page.click('button.CaptchaButton.CaptchaButton_view_action > div');

        try {
            await this.page.waitForNavigation();
        } catch (e) {
            //retrying
        }

        return await this.checkForCaptcha()
    }

    // Get all the search suggestions for the specified keyword
    async collectSearchSuggestions(keyword: string): Promise<SearchSuggestion[] | undefined> {

        await this.checkForCaptcha();

        try {
            this.log(`collect search suggestions for '${keyword}'`);

            const searchSuggestionContainerElement = await this.page.$('div.RelatedBottom-Items');

            if (!searchSuggestionContainerElement) {
                this.log(`there are no search suggestions for '${keyword}'`);
                return undefined;
            }

            const searchSuggestionElements = await searchSuggestionContainerElement.$$('a');

            for (const searchSuggestionElement of searchSuggestionElements) {
                this.serpResult.relatedKeywords.push({
                    suggestion: await searchSuggestionElement.evaluate(searchSuggestionElement => searchSuggestionElement.getAttribute('title')),
                    url: this.url + await searchSuggestionElement.evaluate(searchSuggestionElement => searchSuggestionElement.getAttribute('href'))
                });
            }

            return this.serpResult.relatedKeywords;

        } catch (e) {
            this.log('err while collecting search suggestions: ' + e);
        }
    }

    // Function for collecting search results
    async collectSearchResults(keyword: string, currentPosition: number): Promise<number> {
        let position: number = currentPosition;
        await this.page.waitForSelector('#search-result');

        const searchResultElements = await this.page.$$('#search-result >>> li.serp-item');

        for (let searchResultElement of searchResultElements) {
            const organicListItem = await searchResultElement.$('div.VanillaReact >>> a');

            if (!organicListItem || typeof organicListItem.evaluate === "undefined") continue;

            const searchResult: SearchResult = {
                position: position,
                url: await organicListItem.evaluate(organicListItem => organicListItem.getAttribute('href')),
                anchorLink: await organicListItem.evaluate(organicListItem => organicListItem.textContent),
                textSnippet: await searchResultElement.evaluate(searchResultElement => {
                    const snippedElement = searchResultElement.querySelector('.OrganicTextContentSpan');
                    if (!snippedElement) return '';
                    return snippedElement.textContent;
                }),
            };

            this.postResultToStorage({
                fields: ['keyword', 'position', 'anchor', 'snippet', 'url', 'suggestions'],
                values: {
                    'keyword':      keyword,
                    'position':     searchResult.position,
                    'anchor':       searchResult.anchorLink,
                    'snippet':      searchResult.textSnippet,
                    'url':          searchResult.url,
                    'suggestions':  []
                }
            })

            this.serpResult.searchResults.push(searchResult);
            position++;
        }

        return position;
    }

    // Collect search results from all the specified pages
    async collectResults(keyword: string): Promise<void> {
        try {
            this.log(`collect results for '${keyword}'`);

            let position: number = 1;

            let currentPage = 1;

            position = await this.collectSearchResults(keyword, position);



            while (currentPage < this.task.data.pageNumberValue) {
                currentPage++;
                const nextPageUrl = this.url + await this.page.$$eval('div.Pager-Content >>> div >>> a',
                    navigationPageElements => navigationPageElements[navigationPageElements.length - 1].getAttribute('href'));

                console.log('next page url: ', nextPageUrl);
                this.log(`navigating to page number ${currentPage} for '${keyword}'`);

                await this.page.goto(nextPageUrl, {
                    waitUntil: "networkidle0",
                    timeout: 60000
                });

                await this.checkForCaptcha();

                position = await this.collectSearchResults(keyword, position);
            }

            const amountOfResults: number = position - 1;
            this.serpResult.amountOfResults = amountOfResults;

            this.postResultToTable({
                'Keyword': keyword,
                'Amount of results': amountOfResults,
                'Amount of links collected': amountOfResults,
                'Job result': true
            });

            this.log('finished collecting results');


            this.serpResults.push(this.serpResult);

        } catch (e) {
            this.log('err while collecting results: ' + e);
            this.postResultToTable({
                'Keyword': keyword,
                'Amount of results': 0,
                'Amount of links collected': 0,
                'Job result': false
            });
        }
    }

    // Recursively search and collect results for all the related keywords
    async collectResultsByDepth(currentDepthValue: number, maxDepthValue: number) {
        let currentLevelSearchSuggestion: SearchSuggestion[] = []

        if (currentDepthValue <= maxDepthValue) {

            for (const searchSuggestion of this.searchDepth[currentDepthValue - 1].searchSuggestions) {

                if (searchSuggestion.suggestion &&
                    (!this.serpResults.concat(this.existingResults).some(result => result.keyword === searchSuggestion.suggestion))) {

                    this.log(`navigating to: '${searchSuggestion.suggestion}' related results at depth ${currentDepthValue}`);
                    await this.page.goto(searchSuggestion.url, {
                        waitUntil: "networkidle0",
                        timeout: 15000
                    });

                    this.serpResult = this.initSerpResult(searchSuggestion.suggestion);
                    currentLevelSearchSuggestion = currentLevelSearchSuggestion.concat(await this.collectSearchSuggestions.call(this, searchSuggestion.suggestion));
                    await this.collectResults.call(this, searchSuggestion.suggestion);
                }
            }

            this.searchDepth.push({
                searchDepthValue: currentDepthValue,
                searchSuggestions: currentLevelSearchSuggestion
            });


            await this.collectResultsByDepth.call(this, ++currentDepthValue, maxDepthValue);

        }
    }

    // Returns custom Chromium arguments
    // This is a place to tune Chromium instance
    getPuppeteerArguments(): string[] {
        return [
            this.task.data.proxyServer && this.task.data.proxyPort ?
            `--proxy-server=${this.task.data.proxyServer}:${this.task.data.proxyPort}`: '',
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

    // will be overridden by Template Controller
    async solveCaptcha(captcha: Captcha): Promise<string | object> {
        return ""
    }

    // will be overridden by Template Controller
    postResultToTable(result: object) {

    }

    log(msg: string) {
        console.log(msg);
    }

    delay(time) {
        return new Promise(function(resolve) {
            setTimeout(resolve, time)
        });
    }

    // keep empty, will be replaced by Template Controller
    postResultToStorage(result: TemplateResult) {

    }

}
