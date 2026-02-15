const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();

app.use(express.json());

// Правильный путь к Google Chrome (стабильная версия)
const CHROME_PATH = '/usr/bin/google-chrome-stable';

app.post('/get-token', async (req, res) => {
    const { cookies, proxy, url, awardId } = req.body;
    const log = [];

    const addLog = (msg) => {
        console.log(msg);
        log.push(msg);
    };

    try {
        addLog('📥 Request received');

        if (!cookies || !url) {
            return res.status(400).json({ error: 'Missing cookies or url', log });
        }

        const launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-features=HttpsFirstBalancedModeAutoEnable' // важно для HTTP
        ];
        if (proxy) {
            launchArgs.push(`--proxy-server=${proxy}`);
            addLog(`🌐 Using proxy: ${proxy}`);
        }

        addLog('🚀 Launching browser...');
        const browser = await puppeteer.launch({
            executablePath: CHROME_PATH,
            args: launchArgs,
            headless: true,
            defaultViewport: null
        });
        addLog('✅ Browser launched');

        const page = await browser.newPage();

        if (Array.isArray(cookies)) {
            addLog(`🍪 Setting ${cookies.length} cookies`);
            await page.setCookie(...cookies);
        } else {
            addLog('⚠️ Cookies not an array, skipping');
        }

        addLog('🌍 Navigating to bytick.com');
        await page.goto('https://www.bytick.com', { waitUntil: 'networkidle2', timeout: 30000 });

        addLog(`🌍 Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        addLog('⚙️ Executing page.evaluate with logging...');
const result = await page.evaluate(async (awardId) => {
    // Внутренняя функция для логирования (будет видно в логах Node.js, но не в ответе клиенту)
    const log = (msg) => console.log(`[Evaluate] ${msg}`);

    try {
        log('Starting fetch for risk token...');
        const res1 = await fetch('https://www.bytick.com/x-api/segw/awar/v1/awarding', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ awardID: awardId, spec_code: null, is_reward_hub: true }),
            credentials: 'include'
        });

        log(`Risk token response status: ${res1.status}`);
        const responseText1 = await res1.text(); // Сначала как текст
        log(`Risk token response body: ${responseText1.substring(0, 200)}`); // Логируем начало

        let data1;
        try {
            data1 = JSON.parse(responseText1);
        } catch (e) {
            log(`Failed to parse risk token response as JSON: ${e}`);
            return { error: `Invalid JSON: ${responseText1.substring(0, 100)}` };
        }

        const riskToken = data1?.result?.risk_token || data1?.risk_token;
        if (!riskToken) {
            log(`No risk token found in response. Full response: ${JSON.stringify(data1)}`);
            return { error: 'No risk token', response: data1 };
        }
        log(`Risk token obtained: ${riskToken.substring(0, 30)}...`);

        // --- ШАГ 2 ---
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

        log(`Act token response status: ${res2.status}`);
        const responseText2 = await res2.text();
        log(`Act token response body: ${responseText2.substring(0, 200)}`);

        let data2;
        try {
            data2 = JSON.parse(responseText2);
        } catch (e) {
            log(`Failed to parse act token response as JSON: ${e}`);
            return { error: `Invalid JSON: ${responseText2.substring(0, 100)}` };
        }

        const actToken = data2?.result?.token_info?.token || null;
        if (!actToken) {
            log('No act token in response');
            return { error: 'No act token', response: data2 };
        }

        log('Successfully obtained act token!');
        return actToken;

    } catch (e) {
        log(`Critical error in evaluate: ${e.toString()}`);
        return { error: e.toString() };
    }
}, awardId || 138736);

        await browser.close();

        if (result?.error) {
            res.status(500).json({ error: result.error, log });
        } else if (result) {
            res.json({ success: true, token: result, log });
        } else {
            res.status(500).json({ error: 'Failed to get token', log });
        }
    } catch (error) {
        addLog('💥 ' + error.toString());
        res.status(500).json({ error: error.message, log });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Service running'));
