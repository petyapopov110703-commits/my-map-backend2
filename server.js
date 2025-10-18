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

        console.log('Начинаем парсинг данных для всех маркеров...');

        // --- ПАРСИНГ ДАННЫХ ДЛЯ ВСЕХ МАРКЕРОВ ---
        const objectsData = [];

        // Получаем все .custom-marker
        const customMarkers = await page.$$('.custom-marker');

        for (let i = 0; i < customMarkers.length; i++) {
            console.log(`Обработка маркера ${i + 1} из ${customMarkers.length}...`);

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
                        console.log(`Найдены координаты: [${lat}, ${lon}]`);
                    } else {
                        console.warn(`Не удалось распарсить координаты: lon=${lonStr}, lat=${latStr} (исходный markerId: ${markerId})`);
                    }
                } else {
                    console.warn(`Неверный формат data-marker-id: "${markerId}"`);
                }
            } else {
                console.warn(`data-marker-id пустой.`);
            }

            // --- ИЗВЛЕЧЕНИЕ НАЗВАНИЯ И ЦЕНЫ ---
            // Используем точные селекторы из DevTools
            const objectData = await customMarkers[i].evaluate((markerElement) => {
                // Ищем родительский контейнер карточки
                const cardContainer = markerElement.closest('.card.fixed'); // Или другой класс, если нужно

                let title = 'Название не найдено';
                let price = 'Цена не найдена';

                if (cardContainer) {
                    // Ищем название
                    const titleElement = cardContainer.querySelector('span.hotel-info__title');
                    if (titleElement) {
                        title = titleElement.innerText.trim();
                    }

                    // Ищем цену
                    const priceElement = cardContainer.querySelector('span.price-info__current-price');
                    if (priceElement) {
                        price = priceElement.innerText.trim();
                    }
                }

                return {
                    title: title,
                    price: price
                };
            });

            // --- ПАРСИМ ВСЕ ИЗОБРАЖЕНИЯ ---
            const imageUrls = await customMarkers[i].evaluate((markerElement) => {
                // Ищем родительский контейнер карточки
                const cardContainer = markerElement.closest('.card.fixed'); // Или другой класс, если нужно

                let urls = [];

                if (cardContainer) {
                    // Ищем все img внутри карточки
                    const imgElements = cardContainer.querySelectorAll('img.hotel-card__image');
                    imgElements.forEach(img => {
                        const src = img.getAttribute('src');
                        if (src) {
                            urls.push(src);
                        }
                    });
                }

                // Если нет изображений, добавляем заглушку
                if (urls.length === 0) {
                    urls.push('https://via.placeholder.com/300x200?text=No+Image');
                }

                return urls;
            });

            // Добавляем ID
            objectsData.push({
                id: i + 1,
                title: objectData.title,
                price: objectData.price,
                imageUrls: imageUrls,
                coords: coords
            });
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
