// server.js

// Подключаем библиотеки
const express = require('express');

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
    const puppeteer = require('puppeteer-core'); // <- puppeteer-core, не puppeteer

    try {
        // На Render используем системный Chrome, НЕ указываем executablePath
        const browser = await puppeteer.launch({
            headless: 'new', // Используем новый headless режим
            // executablePath: '/usr/bin/google-chrome-stable', // УБРАТЬ ЭТУ СТРОКУ
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-software-rasterizer',
                '--disable-web-security',
                '--disable-extensions', // Добавим для надёжности
                '--disable-background-timer-throttling', // Добавим для надёжности
                '--disable-backgrounding-occluded-windows', // Добавим для надёжности
                '--disable-renderer-backgrounding' // Добавим для надёжности
            ]
        });
        const page = await browser.newPage();

        // Устанавливаем User-Agent, чтобы не выглядеть как бот
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Переходим на сайт
        await page.goto('https://homereserve.ru/BeWaidhbbl', { waitUntil: 'networkidle2', timeout: 30000 });

        // Ждём, пока появится хотя бы один элемент .hotel-card (или .hotel-card.map)
        await page.waitForSelector('.hotel-card, .hotel-card.map', { timeout: 15000 });
        console.log('Найдены карточки объектов, начинаем парсинг...');

        // Извлекаем названия и цены из карточек объектов
        const objectsData = await page.evaluate(() => {
            // Ищем карточки (обычные и с .map)
            const hotelCards = Array.from(document.querySelectorAll('.hotel-card, .hotel-card.map'));

            return hotelCards.map(card => {
                // Находим название (внутри h2 с классом hotel-info__title)
                const titleElement = card.querySelector('h2.hotel-info__title span');
                // Иногда заголовок может быть без span
                if (!titleElement) {
                    const titleElementFallback = card.querySelector('h2.hotel-info__title');
                    var title = titleElementFallback ? titleElementFallback.innerText.trim() : 'Название не найдено';
                } else {
                    var title = titleElement ? titleElement.innerText.trim() : 'Название не найдено';
                }

                // Находим цену (внутри div с классом price-column)
                // Цена может быть внутри .price-info__current-price или просто в .price-column
                let priceElement = card.querySelector('.price-info__current-price');
                if (!priceElement) {
                    priceElement = card.querySelector('.price-column');
                }
                const price = priceElement ? priceElement.innerText.trim() : 'Цена не найдена';

                // Возвращаем объект с данными
                return {
                    title: title,
                    price: price
                };
            });
        });

        await browser.close();

        console.log('Найденные объекты:', objectsData);

        // Добавляем фиктивные координаты и ID
        cachedData = objectsData.map((obj, index) => ({
            id: index + 1,
            title: obj.title,
            price: obj.price,
            // ВНИМАНИЕ: координаты фиктивные, нужно добавить реальные
            coords: [55.0 + index * 0.001, 37.0 + index * 0.001]
        }));

        lastFetchTime = new Date();
        console.log(`Парсинг завершён. Обновлено ${cachedData.length} объектов. Время: ${lastFetchTime}`);

    } catch (error) {
        console.error('Ошибка при автоматическом парсинге:', error);
        // В реальном приложении логируйте ошибки в файл или систему логирования
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

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
}).on('error', (err) => {
    console.error('Ошибка при запуске сервера:', err);
});
