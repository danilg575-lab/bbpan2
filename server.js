const express = require('express');
const puppeteer = require('puppeteer');
const app = express();

app.use(express.json());

app.post('/get-token', async (req, res) => {
    const { cookies, url, awardId, specCode } = req.body; // awardId и specCode опциональны
    const log = [];

    const addLog = (msg) => {
        console.log(msg);
        log.push(msg);
    };

    try {
        addLog('📥 Request received');
        addLog(`Cookies type: ${typeof cookies}, isArray: ${Array.isArray(cookies)}`);

        if (!cookies || !url) {
            return res.status(400).json({ error: 'Missing cookies or url', log });
        }

        // Подготовка кук (если пришли строкой)
        let parsedCookies = cookies;
        if (typeof cookies === 'string') {
            addLog('⚠️ Cookies is a string, parsing...');
            parsedCookies = cookies.split(';').map(pair => {
                const [name, value] = pair.trim().split('=');
                return { name, value, domain: '.bybit.com', path: '/' };
            }).filter(c => c.name && c.value);
            addLog(`Parsed ${parsedCookies.length} cookies`);
        }

        if (!Array.isArray(parsedCookies)) {
            return res.status(400).json({ error: 'Cookies must be an array', log });
        }

        // Запуск браузера
        addLog('🚀 Launching browser...');
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        addLog('✅ Browser launched');

        const page = await browser.newPage();

        // Установка кук
        addLog(`🍪 Setting ${parsedCookies.length} cookies`);
        await page.setCookie(...parsedCookies);

        // Переход на страницу наград (нужен для контекста)
        addLog(`🌍 Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        addLog('✅ Page loaded');

        // Выполнение цепочки запросов внутри страницы
        addLog('⚙️ Executing page.evaluate...');
        const result = await page.evaluate(async (targetAwardId, targetSpecCode) => {
            const log = (msg) => console.log(`[Evaluate] ${msg}`);

            try {
                // --- ШАГ 1: Получаем список наград (если awardId не передан) ---
                let awardId = targetAwardId;
                let specCode = targetSpecCode;

                if (!awardId) {
                    log('No awardId provided, fetching list...');
                    const listRes = await fetch('https://www.bybit.com/x-api/segw/awar/v1/awarding/search-together', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            pagination: { pageNum: 1, pageSize: 12 },
                            filter: {
                                awardType: 'AWARD_TYPE_UNKNOWN',
                                newOrderWay: true,
                                rewardBusinessLine: 'REWARD_BUSINESS_LINE_DEFAULT',
                                rewardStatus: 'REWARD_STATUS_DEFAULT',
                                getFirstAwardings: false,
                                simpleField: true,
                                allow_amount_multiple: true,
                                return_reward_packet: true,
                                return_transfer_award: true
                            }
                        }),
                        credentials: 'include'
                    });
                    const listData = await listRes.json();
                    log(`Search-together status: ${listRes.status}`);

                    // Берём первую доступную награду (можно улучшить логику)
                    const firstAward = listData?.result?.awardings?.[0];
                    if (!firstAward) throw new Error('No awards found');
                    awardId = firstAward.award_detail.id;
                    specCode = firstAward.spec_code || '';
                    log(`Selected awardId: ${awardId}, specCode: ${specCode}`);
                }

                // --- ШАГ 2: Запрос на получение награды (получаем risk_token) ---
                log(`Fetching award ${awardId}...`);
                const awardRes = await fetch('https://www.bybit.com/x-api/segw/awar/v1/awarding', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        awardID: awardId,
                        spec_code: specCode,
                        is_reward_hub: true
                    }),
                    credentials: 'include'
                });
                const awardData = await awardRes.json();
                log(`Award response status: ${awardRes.status}`);
                log(`Award response: ${JSON.stringify(awardData).substring(0, 200)}`);

                const riskToken = awardData?.result?.risk_token || awardData?.risk_token;
                if (!riskToken) throw new Error('No risk token in award response');

                // --- ШАГ 3: Запрос face token (получаем итоговую ссылку) ---
                log('Fetching face token...');
                const faceRes = await fetch('https://www.bybit.com/x-api/user/public/risk/face/token', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json;charset=UTF-8',
                        'platform': 'pc'
                    },
                    body: JSON.stringify({ risk_token: riskToken }),
                    credentials: 'include'
                });
                const faceData = await faceRes.json();
                log(`Face token status: ${faceRes.status}`);

                const finalUrl = faceData?.result?.token_info?.token;
                if (!finalUrl) throw new Error('No final URL in face token response');

                log('✅ Final URL obtained');
                return finalUrl;

            } catch (e) {
                log(`Critical error: ${e}`);
                return { error: e.toString() };
            }
        }, awardId || null, specCode || ''); // передаём опциональные параметры

        await browser.close();

        if (result && result.error) {
            addLog('❌ Error from evaluate: ' + result.error);
            res.status(500).json({ error: result.error, log });
        } else if (result) {
            addLog('🎉 Final URL: ' + result.substring(0, 50) + '...');
            res.json({ success: true, url: result, log });
        } else {
            addLog('❌ No result');
            res.status(500).json({ error: 'Failed to get URL', log });
        }

    } catch (error) {
        addLog('💥 Fatal error: ' + error.toString());
        res.status(500).json({ error: error.message, log });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Service running on port ${PORT}`));
