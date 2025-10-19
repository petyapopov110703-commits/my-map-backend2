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
                // Ищем span с адресом, который находится на одном уровне с .hotel-info
                // На основе скриншота: это span с data-v-11c9ea5, содержащий "Дивеево"
                let address = 'Адрес не найден';
                const addressSpanByAttr = card.querySelector('span[data-v-11c9ea5]');
                if (addressSpanByAttr) {
                    address = addressSpanByAttr.innerText.trim();
                }

                // Если не нашли по атрибуту, ищем по тексту
                if (address === 'Адрес не найден') {
                    const allSpans = card.querySelectorAll('span');
                    for (const span of allSpans) {
                        if (span.innerText.includes('Дивеево') && span.innerText.includes('улица')) {
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

        console.log('Найденные объекты (до геокодирования):', objectsData);

        // --- ГЕОКОДИРОВАНИЕ АДРЕСОВ ---
        const geocodedData = await Promise.all(objectsData.map(async (obj) => {
            try {
                const address = obj.address;
                if (!address || address === 'Адрес не найден') {
                    console.warn(`Адрес не найден для объекта: ${obj.title}. Пропускаем геокодирование.`);
                    return { ...obj, coords: null };
                }

                // Запрос к геокодеру Яндекс.Карт
                // Используем переменную окружения, если установлена, иначе ваш ключ
                const YANDEX_API_KEY = process.env.YANDEX_API_KEY || 'c1a3b274-ff9b-4ff8-b63d-fecf02674203';
                const response = await fetch(`https://geocode-maps.yandex.ru/1.x/?format=json&apikey=${YANDEX_API_KEY}&geocode=${encodeURIComponent(address)}`);

                // Проверяем, успешен ли HTTP-запрос
                if (!response.ok) {
                    console.error(`HTTP ошибка при геокодировании адреса "${address}": ${response.status} ${response.statusText}`);
                    return { ...obj, coords: null };
                }

                const data = await response.json();
                // console.log(`Ответ от геокодера для "${address}":`, JSON.stringify(data, null, 2)); // Логируем ответ для отладки

                // Проверяем, есть ли в ответе ожидаемая структура
                if (!data.response || !data.response.GeoObjectCollection || !data.response.GeoObjectCollection.featureMember) {
                    console.warn(`Некорректная структура ответа геокодера для адреса "${address}":`, data);
                    return { ...obj, coords: null };
                }

                const firstResult = data.response.GeoObjectCollection.featureMember[0]?.GeoObject;

                if (firstResult) {
                    const coordsStr = firstResult.Point.pos; // "39.707686 55.753703"
                    const [lon, lat] = coordsStr.split(' ').map(Number);
                    if (isNaN(lat) || isNaN(lon)) {
                        console.warn(`Некорректные координаты из геокодера для адреса "${address}": ${coordsStr}`);
                        return { ...obj, coords: null };
                    }
                    return { ...obj, coords: [lat, lon] }; // [широта, долгота]
                } else {
                    console.warn(`Не удалось найти координаты для адреса: ${address}`);
                    return { ...obj, coords: null };
                }
            } catch (err) {
                console.error(`Ошибка при геокодировании адреса "${obj.address}":`, err.message);
                // Выводим стек вызовов для лучшего понимания ошибки
                console.error(err.stack);
                return { ...obj, coords: null };
            }
        }));

        console.log('Данные после геокодирования:', geocodedData);

        // Обновляем кешированные данные
        cachedData = geocodedData.map((obj, index) => ({
            id: index + 1,
            title: obj.title,
            price: obj.price,
            imageUrls: obj.imageUrls,
            address: obj.address,
            coords: obj.coords // <-- Теперь это массив [широта, долгота] или null
        }));

        lastFetchTime = new Date();
        console.log(`Парсинг и геокодирование завершены. Обновлено ${cachedData.filter(obj => obj.coords !== null).length} объектов с координатами. Время: ${lastFetchTime}`);

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
        cachedObjectsWithCoordsCount: cachedData.filter(obj => obj.coords !== null).length, // Добавлено
        lastFetchTime: lastFetchTime ? lastFetchTime.toISOString() : null,
        uptime: process.uptime()
    });
});

// --- МАРШРУТ ДЛЯ КОРНЕВОГО URL ---
app.get('/', (req, res) => {
    res.send(`
        <h1>✅ Сервер my-map-backend2 запущен!</h1>
        <p>Данные успешно спарсены: ${cachedData.length} объектов, из них с координатами: ${cachedData.filter(obj => obj.coords !== null).length}.</p>
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
