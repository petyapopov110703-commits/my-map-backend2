// Подключаем библиотеки
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Настройка CORS ---
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});
// --- Конец настройки CORS ---

// Переменная для хранения последних данных
let cachedData = [];
let lastFetchTime = null;

// Функция для парсинга данных
async function fetchDataAndCache() {
    console.log('Запуск автоматического парсинга...');
    let browser;
    try {
        // Запускаем браузер с помощью @sparticuz/chromium
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(), // Указываем путь к Chromium
            headless: chromium.headless, // Используем headless режим от chromium
            args: [
                ...chromium.args, // Аргументы от chromium
                '--disable-web-security', // Дополнительные аргументы
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer'
            ],
            defaultViewport: chromium.defaultViewport, // Используем viewport от chromium
        });

        const page = await browser.newPage();

        // Устанавливаем User-Agent, чтобы не выглядеть как бот
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Переходим на сайт
        await page.goto('https://homereserve.ru/BeWaidhbbl', { waitUntil: 'networkidle2', timeout: 30000 });

        console.log('Ожидаем появления таба "На карте"...');

        // --- ЖДЕМ, ПОКА ПОЯВИТСЯ ТАБ "НА КАРТЕ" ---
        try {
            // Ищем таб "На карте"
            const mapTab = await page.waitForSelector('text=На карте', { timeout: 15000 });
            console.log('Таб "На карте" найден.');

            // Кликаем по табу "На карте"
            await mapTab.click();
            console.log('Кликнули по табу "На карте".');
        } catch (waitError) {
            console.error('Ошибка ожидания таба "На карте":', waitError.message);
            throw waitError;
        }

        console.log('Ожидаем появления маркеров...');

        // --- ЖДЕМ, ПОКА ПОЯВЯТСЯ МАРКЕРЫ ---
        try {
            // Ожидаем, пока появится хотя бы один маркер
            await page.waitForSelector('.custom-marker', { timeout: 15000 });
            console.log('Найдены маркеры.');
        } catch (waitError) {
            console.error('Ошибка ожидания маркеров:', waitError.message);
            throw waitError;
        }

        console.log('Начинаем парсинг данных для каждого маркера...');

        // --- ПАРСИНГ ДАННЫХ ДЛЯ КАЖДОГО МАРКЕРА ---
        const objectsData = [];

        // Получаем все .custom-marker
        const customMarkers = await page.$$('.custom-marker');

        for (let i = 0; i < customMarkers.length; i++) {
            console.log(`Обработка маркера ${i + 1} из ${customMarkers.length}...`);

            // Кликаем на маркер
            await customMarkers[i].click();

            // Ждём появление всплывающего окна (balloon)
            // Селектор для всплывающего окна Яндекс Карты
            const balloonSelector = '.ymaps3x0--balloon';
            try {
                await page.waitForSelector(balloonSelector, { timeout: 5000 });
                console.log('Всплывающее окно найдено.');
            } catch (cardError) {
                console.warn(`Всплывающее окно не появилось для маркера ${i + 1}.`);
                // Если окно не появилось, пропускаем этот маркер
                continue;
            }

            // --- ИЗВЛЕЧЕНИЕ ДАННЫХ ИЗ ВСПЛЫВАЮЩЕГО ОКНА ---
            const objectData = await page.evaluate(() => {
                // Ищем элемент с названием объекта внутри всплывающего окна
                const titleElement = document.querySelector('.ymaps3x0--balloon span.hotel-info__title');
                let title = 'Название не найдено';
                if (titleElement) {
                    title = titleElement.innerText.trim();
                }

                // Ищем элемент с ценой внутри всплывающего окна
                const priceElement = document.querySelector('.ymaps3x0--balloon span.price-info__current-price');
                let price = 'Цена не найдена';
                if (priceElement) {
                    price = priceElement.innerText.trim();
                }

                // --- ПАРСИМ ВСЕ ИЗОБРАЖЕНИЯ ---
                // Ищем все элементы img внутри всплывающего окна
                const imgElements = document.querySelectorAll('.ymaps3x0--balloon img.hotel-card__image');
                let imageUrls = []; // Массив для хранения URL всех изображений

                if (imgElements.length > 0) {
                    // Проходим по всем img и получаем src
                    imgElements.forEach(img => {
                        const src = img.getAttribute('src');
                        if (src) {
                            imageUrls.push(src);
                        }
                    });
                }

                // Если нет изображений, добавляем заглушку
                if (imageUrls.length === 0) {
                    imageUrls.push('https://via.placeholder.com/300x200?text=No+Image');
                }

                return {
                    title: title,
                    price: price,
                    imageUrls: imageUrls
                };
            });

            // --- ИЗВЛЕЧЕНИЕ КООРДИНАТ ИЗ data-marker-id ---
            const markerId = await customMarkers[i].evaluate(el => el.getAttribute('data-marker-id'));
            let coords = [55.0, 37.0]; // Фиктивные координаты по умолчанию

            if (markerId) {
                // Убираем префикс 'group_' перед разбором
                const cleanedMarkerId = markerId.replace(/^group_/, '');
                // Разбиваем строку по запятой
                const parts = cleanedMarkerId.split(',');
                if (parts.length >= 2) {
                    // Берем последние два числа как долготу и широту
                    const lonStr = parts[parts.length - 2];
                    const latStr = parts[parts.length - 1];

                    const lon = parseFloat(lonStr);
                    const lat = parseFloat(latStr);

                    if (!isNaN(lon) && !isNaN(lat)) {
                        coords = [lat, lon]; // Яндекс Карты использует [широта, долгота]
                        console.log(`Найдены координаты для "${objectData.title}": [${lat}, ${lon}]`);
                    } else {
                        console.warn(`Не удалось распарсить координаты для "${objectData.title}": lon=${lonStr}, lat=${latStr} (исходный markerId: ${markerId})`);
                    }
                } else {
                    console.warn(`Неверный формат data-marker-id для "${objectData.title}": "${markerId}"`);
                }
            } else {
                console.warn(`data-marker-id пустой для "${objectData.title}"`);
            }

            // Добавляем ID
            objectsData.push({
                id: i + 1,
                title: objectData.title,
                price: objectData.price,
                imageUrls: objectData.imageUrls,
                coords: coords
            });

            // --- ЗАКРЫТИЕ ВСПЛЫВАЮЩЕГО ОКНА ---
            // Ищем кнопку закрытия (обычно это крестик в правом верхнем углу всплывающего окна Яндекс Карт)
            // Обычно это <ymaps class="ymaps3x0--balloon__close-button">
            const closeButton = await page.$('ymaps.ymaps3x0--balloon__close-button');
            if (closeButton) {
                await closeButton.click();
                console.log('Всплывающее окно закрыто.');
            } else {
                console.warn('Кнопка закрытия всплывающего окна не найдена.');
                // Альтернатива: клик по фону карты (может не сработать или закрыть не то окно)
                // await page.click('ymaps.ymaps3x0--map');
            }

            // Делаем паузу между кликами, чтобы дать времени на закрытие окна
            await page.waitForTimeout(1000); // Исправлено: await добавлен
        }

        console.log('Найденные объекты (с координатами):', objectsData);

        // Сохраняем данные
        cachedData = objectsData;

        lastFetchTime = new Date();
        console.log(`Парсинг завершён. Обновлено ${cachedData.length} объектов. Время: ${lastFetchTime}`);

    } catch (error) {
        console.error('Ошибка при автоматическом парсинге:', error.message); // Выводим сообщение об ошибке
        // В реальном приложении логируйте ошибки в файл или систему логирования
    } finally {
        // Обязательно закрываем браузер, даже если произошла ошибка
        if (browser) {
            await browser.close();
        }
    }
}

// Запускаем первый парсинг при старте сервера
fetchDataAndCache();

// Устанавливаем интервал для автоматического обновления (например, раз в 24 часа)
// 24 часа * 60 минут * 60 секунд * 1000 миллисекунд = 86400000 миллисекунд
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 часа

setInterval(fetchDataAndCache, REFRESH_INTERVAL_MS);

// Маршрут для получения данных
app.get('/api/objects', (req, res) => {
    console.log('Получен запрос на /api/objects');
    // Возвращаем закешированные данные
    res.json(cachedData);
});

// Маршрут для проверки статуса
app.get('/status', (req, res) => {
    res.json({
        status: 'OK',
        cachedObjectsCount: cachedData.length,
        lastFetchTime: lastFetchTime ? lastFetchTime.toISOString() : null,
        uptime: process.uptime()
    });
});

// --- МАРШРУТ ДЛЯ КОРНЕВОГО URL ---
app.get('/', (req, res) => {
    res.send(`
        <h1>✅ Сервер my-map-backend2 запущен!</h1>
        <p>Данные успешно спарсены: ${cachedData.length} объектов.</p>
        <p>Последнее обновление: ${lastFetchTime ? lastFetchTime.toLocaleString() : 'ещё не было'}</p>
        <ul>
            <li><a href="/api/objects">Посмотреть данные (/api/objects)</a></li>
            <li><a href="/status">Проверить статус (/status)</a></li>
        </ul>
    `);
});

// Запускаем сервер, слушаем 0.0.0.0 (важно для Render)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
}).on('error', (err) => {
    console.error('Ошибка при запуске сервера:', err);
});
