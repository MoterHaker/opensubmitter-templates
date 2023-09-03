/// <reference path="type.d.ts" />

const fs = require("fs")

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
    existingResults: SerpResult[] = [];

    config: TemplateConfig = {

        // Name and description to display in OpenSubmitter's UI:
        name: 'Bing SERP Parser (puppeteer)',
        description: `Opens bing and based on provided: keywords and page number, collects data (urls, link anchors, text snippets, position numbers, list of related keywords);
        moreover based on provided depth level will recursively collect data for all the subsequent related keywords,
        works with puppeteer-chromium in headless mode and writes the results in a single file output file`,
        email: 'dev@opensubmitter.com',
        rewardTronAddress: 'TPNnu4Wc5dUtpVt5dpQce32WnTrd4P5555',

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
                required: false, // If I make it true then the 
                uiWidth: 100,
            },
            {
                type: 'Checkbox',
                name: 'alsoSearchedFor',
                title: 'People also searched for',
                value: false,
                uiWidth: 50,
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
                fileName: '',
                value: 'JSON',
                required: true,
                uiWidth: 100
            }
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
        ]
    };

    // Dummy variable, will be overridden by OpenSubmitter with Puppeteer's page object
    page = null;
    task: TemplateTask;

    async generateTasks(...args: any): Promise<TemplateTask[]> {
        const keywordsValue = this.config.userSettings.find(setting => setting.name === 'keywords')?.value;

        const keywordsList = keywordsValue?.toString().split("\n")

        const keywordsListHasDuplicates = new Set(keywordsList).size !== keywordsList?.length;

        const alsoSearchedForValue = this.config.userSettings.find(setting => setting.name === 'alsoSearchedFor')?.value;

        const searchDepthValue = this.config.userSettings.find(setting => setting.name === 'searchDepth')?.value;

        const pageNumberValue = this.config.userSettings.find(setting => setting.name === 'pageNumber')?.value || 1;

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
                const randomProxy: Proxy = proxies.length > 0 ?
                    proxies[Math.floor(Math.random() * proxies.length)] :
                    { proxyServer: '', proxyPort: '', proxyLogin: '', proxyPassword: '' };

                const isLastTaskKeyword: boolean = keywordsList.indexOf(keyword) === keywordsList.length - 1;

                return {
                    data: {
                        keyword,
                        keywordsListHasDuplicates,
                        alsoSearchedForValue,
                        searchDepthValue,
                        pageNumberValue,
                        ...randomProxy,
                        outputFormatValue,
                        fileName,
                        isLastTaskKeyword
                    }
                }
            }) : [];

        return result;
    }


    async runTask(task: TemplateTask) {
        let serpResult: SerpResult = initSerpResult(task.data.keyword);

        const serpResults: SerpResult[] = [];
        const searchDepth: SearchDepth[] = [];

        const url = 'https://www.bing.com';

        function initSerpResult(keyword: string): SerpResult {
            return {
                keyword: keyword,
                relatedKeywords: [],
                amountOfResults: 0,
                searchResults: []
            };
        }

        async function defaultNavigationAndSearch(page): Promise<void> {

            try {
                // Setting proxy authorization if credentials are provided
                if (task.data.proxyLogin && task.data.proxyPassword) {
                    this.log(`setting proxy authentication ${task.data.proxyLogin}:${task.data.proxyPassword}`);
                    await this.page.authenticate({
                        username: task.data.proxyLogin,
                        password: task.data.proxyPassword,
                    });
                }
            } catch (e) {
                this.log('err while setting proxy authentication: ' + e);
            }

            try {
                const searchUrl: string = `${url}/search?q=${task.data.keyword.replace(/ /g, '+')}`;
                this.log(`navigating to ${searchUrl}...`);

                await page.goto(searchUrl);
            } catch (e) {
                this.log('err while loading the page: ' + e);
            }
        }

        // Get all the search suggestions for the specified keyword
        async function collectSearchSuggestions(keyword: string): Promise<SearchSuggestion[] | undefined> {
            try {
                this.log(`collect search suggestions for '${keyword}'`);
    
                const searchSuggestionContainerElement = await this.page.$('#brsv3');

                if (!searchSuggestionContainerElement) {
                    this.log(`there are no search suggestions for '${keyword}'`);
                    return undefined;
                }

                const searchSuggestionElements = await searchSuggestionContainerElement.$$('li >>> a');
    
                for (const searchSuggestionElement of searchSuggestionElements) {
                    serpResult.relatedKeywords.push({
                        suggestion: await searchSuggestionElement.evaluate(searchSuggestionElement => searchSuggestionElement.textContent),
                        url: url + await searchSuggestionElement.evaluate(searchSuggestionElement => searchSuggestionElement.getAttribute('href'))
                    });
                }

                return serpResult.relatedKeywords;
    
            } catch (e) {
                this.log('err while collecting search suggestions: ' + e);   
            }
        }

        // Function for getting the text snippet of a search result
        async function getSearchResultTextSnippet(searchResultElement): Promise<string | undefined> {
            const textSnippetElements = await searchResultElement.$$('div >>> p');

            for (const textSnippetElement of textSnippetElements) {
                const textSnippetClass: string  = await (await textSnippetElement.getProperty('className')).jsonValue();

                if (textSnippetClass.includes('b_lineclamp')) {
                    return (await textSnippetElement.evaluate(textSnippetElement => textSnippetElement.textContent)).slice(3);
                }
            }
        }

        // Function for collecting search results
        async function collectSearchResults(page, currentPosition: number): Promise<number> {
            let position: number = currentPosition;
            await page.waitForSelector('#b_results >>> li.b_algo >>> h2 >>> a');

            const searchrResultElements = await page.$$('#b_results >>> li.b_algo');

            for (let searchResultElement of searchrResultElements) {
                const organicListItem = await searchResultElement.$('h2 >>> a');

                const searchResult: SearchResult = {
                    position: position,
                    url: await organicListItem.evaluate(organicListItem => organicListItem.getAttribute('href')),
                    anchorLink: await organicListItem.evaluate(organicListItem => organicListItem.textContent),
                    textSnippet: await getSearchResultTextSnippet(searchResultElement) || ''
                };

                serpResult.searchResults.push(searchResult);
                position++;
            }

            return position;
        }

        // Collect search results from all the specified pages
        async function collectResults(keyword: string): Promise<void> {
            try {
                this.log(`collect results for '${keyword}'`);
    
                let position: number = 1;
    
                let currentPage = 1;
    
                position = await collectSearchResults(this.page, position);
    
                while (currentPage < task.data.pageNumberValue) {
                    const nextPageUrl = url + await this.page.$$eval('li.b_pag >>> li >>> a',
                        navigationPageElements => navigationPageElements[navigationPageElements.length - 1].getAttribute('href'));
    
                    currentPage++;
                    this.log(`navigating to page number: ${currentPage}`);
    
                    await this.page.goto(nextPageUrl);
    
                    position = await collectSearchResults(this.page, position);
                }

                const amountOfResults: number = position - 1;
                serpResult.amountOfResults = amountOfResults;

                this.postResultToTable({
                    'Keyword': keyword,
                    'Amount of results': amountOfResults,
                    'Amount of links collected': amountOfResults,
                    'Job result': true
                });
    

                this.broadcastMessageToThreads(serpResult);

                this.postResultToStorage({
                    fields: ['keyword', 'relatedKeywords', 'amountOfResults', 'searchResults'],
                    values: serpResult
                });

                serpResults.push(serpResult);

                this.log(`finished collecting results for '${keyword}'`);
    
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
        async function collectResultsByDepth(currentDepthValue: number, maxDepthValue: number) {
            try {
                let currentLevelSearchSuggestion: SearchSuggestion[] = [];

                if (currentDepthValue <= maxDepthValue) {
    
                    for (const searchSuggestion of searchDepth[currentDepthValue - 1].searchSuggestions) {
    
                        if (searchSuggestion.suggestion &&
                            (!serpResults.concat(this.existingResults).some(result => result.keyword === searchSuggestion.suggestion))) {
    
                            this.log(`navigating to: '${searchSuggestion.suggestion}' results`);
                            await this.page.goto(searchSuggestion.url);
                
                            serpResult = initSerpResult(searchSuggestion.suggestion);
                            currentLevelSearchSuggestion = currentLevelSearchSuggestion.concat(await collectSearchSuggestions.call(this, searchSuggestion.suggestion));
                            await collectResults.call(this, searchSuggestion.suggestion);
                        }
                    }
    
                    searchDepth.push({
                        searchDepthValue: currentDepthValue,
                        searchSuggestions: currentLevelSearchSuggestion
                    });
    
                    await collectResultsByDepth.call(this, ++currentDepthValue, maxDepthValue);
                }

            } catch (e) {
                this.log('err while collecting related search results: ' + e);
            }
        }

        // Execution part
        if (!task.data.keywordsListHasDuplicates) {

            if (!this.existingResults.some(result => result.keyword === task.data.keyword)) {
                await defaultNavigationAndSearch.call(this, this.page);

                searchDepth.push({
                    searchDepthValue: 0,
                    searchSuggestions: await collectSearchSuggestions.call(this, task.data.keyword)
                });
                
                await collectResults.call(this, task.data.keyword);

                if (task.data.alsoSearchedForValue && task.data.searchDepthValue > 0 && task.data.searchDepthValue < 5) {
                    await collectResultsByDepth.call(this, 1, task.data.searchDepthValue);
                }

            } else {
                this.log(`keyword '${task.data.keyword}' already exists in the output file`);
            }

        } else {
            this.log('The keywords list has duplicate values, skipping this task');
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
    postResultToTable(result: object) {
    }

    // will be overridden by Template Controller
    postResultToStorage(result: object) {
    }

    // will be overridden by Template Controller
    broadcastMessageToThreads(newSerpResult: SerpResult) {
    }

    // will be overridden by Template Controller
    receiveBroadcastMessage(newSerpResults: SerpResult) {
        if (!this.existingResults.some(results => results.keyword === newSerpResults.keyword)) {
            this.existingResults.push(newSerpResults);
        }
    }

    log(msg: string) {
        console.log(msg);
    }
}
