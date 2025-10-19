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

        // НЕ нажимаем на таб "На карте"

        // Ждём, пока появится хотя бы один элемент .hotel-card (или .hotel-card.map)
        console.log('Ожидаем появления карточек объектов...');
        await page.waitForSelector('.hotel-card, .hotel-card.map', { timeout: 15000 });
        console.log('Найдены карточки объектов, начинаем парсинг...');

        // --- ИЗМЕНЁННЫЙ БЛОК page.evaluate ---
        const objectsData = await page.evaluate(() => {
            // Ищем карточки (обычные и с .map)
            const hotelCards = Array.from(document.querySelectorAll('.hotel-card, .hotel-card.map'));

            return hotelCards.map((card, index) => {
                // Находим название (внутри h2 с классом hotel-info__title)
                const titleElement = card.querySelector('h2.hotel-info__title span');
                // Иногда заголовок может быть без span
                let title;
                if (!titleElement) {
                    const titleElementFallback = card.querySelector('h2.hotel-info__title');
                    title = titleElementFallback ? titleElementFallback.innerText.trim() : 'Название не найдено';
                } else {
                    title = titleElement ? titleElement.innerText.trim() : 'Название не найдено';
                }

                // Находим цену (внутри div с классом price-column)
                // Цена может быть внутри .price-info__current-price или просто в .price-column
                let priceElement = card.querySelector('.price-info__current-price');
                if (!priceElement) {
                    priceElement = card.querySelector('.price-column');
                }
                const price = priceElement ? priceElement.innerText.trim() : 'Цена не найдена';

                // --- ПАРСИМ ВСЕ ИЗОБРАЖЕНИЯ ---
                // Ищем все элементы img внутри .hotel-card__slide
                const imgElements = card.querySelectorAll('.hotel-card__slide img'); // Получаем все img
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

                // --- ПАРСИМ АДРЕС ---
                // Ищем элемент с адресом (span внутри .hotel-info)
                // Судя по скриншоту, это span с текстом "Дивеево, Лучистая улица, 5"
                // Класс span динамический, поэтому ищем по родительскому контейнеру .hotel-info
                let address = 'Адрес не найден';
                const hotelInfo = card.querySelector('.hotel-info');
                if (hotelInfo) {
                    // Ищем span внутри .hotel-info
                    const addressSpan = hotelInfo.querySelector('span');
                    if (addressSpan) {
                        address = addressSpan.innerText.trim();
                    }
                }
                // Если не нашли, попробуем найти по тексту (если он содержит "Дивеево")
                if (address === 'Адрес не найден') {
                    const allSpans = card.querySelectorAll('span');
                    for (const span of allSpans) {
                        if (span.innerText.includes('Дивеево')) {
                            address = span.innerText.trim();
                            break;
                        }
                    }
                }

                // Возвращаем объект с данными (используем английские ключи)
                return {
                    title: title,
                    price: price,
                    imageUrls: imageUrls, // <-- Теперь массив URL изображений
                    address: address      // <-- Добавляем поле с адресом
                };
            });
        });

        console.log('Найденные объекты (до добавления координат):', objectsData);

        // Добавляем адрес в coords (как строку) для использования в Яндекс Карты API
        cachedData = objectsData.map((obj, index) => ({
            id: index + 1,
            title: obj.title, // <-- используем согласованный ключ
            price: obj.price, // <-- используем согласованный ключ
            imageUrls: obj.imageUrls, // <-- используем согласованный ключ
            address: obj.address, // <-- используем согласованный ключ
            // Передаём адрес в coords как строку для Яндекс Карт
            coords: obj.address // <-- Передаём адрес как строку
        }));

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
