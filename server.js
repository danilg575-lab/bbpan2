const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const app = express();

app.use(express.json());

// Путь к системному Chrome (может отсутствовать)
const SYSTEM_CHROME = '/usr/bin/google-chrome-stable';

// Функция для проверки наличия системного Chrome
function getChromePath() {
    if (fs.existsSync(SYSTEM_CHROME)) {
        console.log(`✅ Using system Chrome at ${SYSTEM_CHROME}`);
        return SYSTEM_CHROME;
    }
    console.log('⚠️ System Chrome not found, will use bundled Chromium');
    return null;
}

app.post('/get-token', async (req, res) => {
    const { cookies, proxy, url, awardId } = req.body;
    const log = [];

    const addLog = (msg) => {
        console.log(msg);
        log.push(msg);
    };

    try {
        addLog('📥 Request received');
        addLog(`Body keys: ${Object.keys(req.body).join(', ')}`);
        addLog(`Cookies type: ${typeof cookies}, isArray: ${Array.isArray(cookies)}`);

        if (!cookies || !url) {
            return res.status(400).json({ error: 'Missing cookies or url', log });
        }

        // Преобразуем cookies, если они пришли строкой
        let parsedCookies = cookies;
        if (typeof cookies === 'string') {
            addLog('⚠️ Cookies is a string, attempting to parse...');
            // Пример: "name1=value1; name2=value2"
            parsedCookies = cookies.split(';').map(pair => {
                const [name, value] = pair.trim().split('=');
                return { name, value, domain: '.bytick.com', path: '/' };
            }).filter(c => c.name && c.value);
            addLog(`Parsed ${parsedCookies.length} cookies from string`);
        }

        // Убедимся, что это массив объектов
        if (!Array.isArray(parsedCookies)) {
            addLog('❌ Cookies is not an array after parsing');
            return res.status(400).json({ error: 'Cookies must be an array', log });
        }

        // Аргументы запуска браузера
        const launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-features=HttpsFirstBalancedModeAutoEnable'
        ];
        if (proxy) {
            // Пытаемся преобразовать прокси в нужный формат
            let proxyServer = proxy;
            if (!proxy.startsWith('http://') && !proxy.startsWith('https://')) {
                const parts = proxy.split(':');
                if (parts.length === 4) {
                    // host:port:user:pass -> http://user:pass@host:port
                    proxyServer = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
                } else if (parts.length === 2) {
                    proxyServer = `http://${parts[0]}:${parts[1]}`;
                }
            }
            launchArgs.push(`--proxy-server=${proxyServer}`);
            addLog(`🌐 Using proxy: ${proxyServer.replace(/:.+@/, ':****@')}`);
        }

        // Выбираем исполняемый файл Chrome
        const executablePath = getChromePath();
        const launchOptions = {
            args: launchArgs,
            headless: true,
            defaultViewport: null
        };
        if (executablePath) {
            launchOptions.executablePath = executablePath;
        }

        addLog('🚀 Launching browser...');
        const browser = await puppeteer.launch(launchOptions);
        addLog('✅ Browser launched');

        const page = await browser.newPage();

        addLog(`🍪 Setting ${parsedCookies.length} cookies`);
        await page.setCookie(...parsedCookies);

        addLog('🌍 Navigating to bytick.com');
        await page.goto('https://www.bytick.com', { waitUntil: 'networkidle2', timeout: 30000 });

        addLog(`🌍 Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        addLog('⚙️ Executing page.evaluate with detailed logging...');
        const result = await page.evaluate(async (awardId) => {
            const log = (msg) => console.log(`[Evaluate] ${msg}`);

            try {
                log('Fetching risk token...');
                const res1 = await fetch('https://www.bytick.com/x-api/segw/awar/v1/awarding', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ awardID: awardId, spec_code: null, is_reward_hub: true }),
                    credentials: 'include'
                });

                log(`Risk token status: ${res1.status}`);
                const text1 = await res1.text();
                log(`Risk token body: ${text1.substring(0, 200)}`);

                let data1;
                try {
                    data1 = JSON.parse(text1);
                } catch (e) {
                    log(`JSON parse error: ${e}`);
                    return { error: `Invalid JSON: ${text1.substring(0, 100)}` };
                }

                const riskToken = data1?.result?.risk_token || data1?.risk_token;
                if (!riskToken) {
                    log('No risk token found');
                    return { error: 'No risk token', response: data1 };
                }

                log(`Risk token obtained: ${riskToken.substring(0, 30)}...`);

                log('Fetching act token...');
                const res2 = await fetch('https://www.bytick.com/x-api/user/public/risk/face/token', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json;charset=UTF-8',
                        'platform': 'pc'
                    },
                    body: JSON.stringify({ risk_token: riskToken }),
                    credentials: 'include'
                });

                log(`Act token status: ${res2.status}`);
                const text2 = await res2.text();
                log(`Act token body: ${text2.substring(0, 200)}`);

                let data2;
                try {
                    data2 = JSON.parse(text2);
                } catch (e) {
                    log(`JSON parse error: ${e}`);
                    return { error: `Invalid JSON: ${text2.substring(0, 100)}` };
                }

                const actToken = data2?.result?.token_info?.token || null;
                if (!actToken) {
                    log('No act token found');
                    return { error: 'No act token', response: data2 };
                }

                log('✅ Act token obtained!');
                return actToken;
            } catch (e) {
                log(`Critical error: ${e}`);
                return { error: e.toString() };
            }
        }, awardId || 138736);

        addLog('✅ Evaluate completed');
        await browser.close();
        addLog('🔒 Browser closed');

        if (result && result.error) {
            addLog('❌ Error from evaluate: ' + result.error);
            res.status(500).json({ error: result.error, response: result.response, log });
        } else if (result) {
            addLog('🎉 Token obtained: ' + result.substring(0, 50) + '...');
            res.json({ success: true, token: result, log });
        } else {
            addLog('❌ No token returned');
            res.status(500).json({ error: 'Failed to get token', log });
        }

    } catch (error) {
        addLog('💥 Fatal error: ' + error.toString());
        res.status(500).json({ error: error.message, log });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Service running on port ${PORT}`));
