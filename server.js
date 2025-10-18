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

        // --- ЖДЕМ, ПОКА ПОЯВЯТСЯ МАРКЕРЫ (.custom-marker) ---
        try {
            // Ожидаем, пока появится хотя бы один .custom-marker
            await page.waitForSelector('.custom-marker', { timeout: 15000 });
            console.log('Найдены маркеры (.custom-marker).');
        } catch (waitError) {
            console.error('Ошибка ожидания маркеров (.custom-marker):', waitError.message);
            throw waitError;
        }

        console.log('Начинаем парсинг данных для каждого маркера...');

        // --- ПАРСИНГ ДАННЫХ ДЛЯ КАЖДОГО МАРКЕРА ---
        const objectsData = [];

        // Получаем все .custom-marker
        const customMarkers = await page.$$('.custom-marker');

        for (let i = 0; i < customMarkers.length; i++) {
            console.log(`Обработка маркера ${i + 1} из ${customMarkers.length}...`);

            // Кликаем на .custom-marker
            await customMarkers[i].click();

            // Ждём появление контейнера с карточками (например, .card.fixed)
            // Судя по видео, это может быть div с классом .card fixed
            const cardContainerSelector = '.card.fixed, .popup, .modal';
            try {
                await page.waitForSelector(cardContainerSelector, { timeout: 8000 }); // Увеличили таймаут
                console.log('Контейнер с карточками найден.');
            } catch (cardError) {
                console.warn(`Контейнер с карточками не появился для маркера ${i + 1} после клика.`);
                // Если контейнер не появился, пропускаем этот маркер
                continue;
            }

            // --- ИЗВЛЕЧЕНИЕ ДАННЫХ ИЗ КОНТЕЙНЕРА С КАРТОЧКАМИ ---
            const objectData = await page.evaluate(() => {
                // Ищем контейнер с карточками
                const cardContainer = document.querySelector('.card.fixed, .popup, .modal');
                if (!cardContainer) {
                    console.warn('Контейнер с карточками не найден в evaluate.');
                    return { title: 'Название не найдено', price: 'Цена не найдена', imageUrls: [] };
                }

                // Ищем элемент с названием объекта внутри контейнера
                // Судя по видео, название находится в h4 внутри .hotel-info__title
                const titleElement = cardContainer.querySelector('h4.hotel-info__title, span.hotel-info__title');
                let title = 'Название не найдено';
                if (titleElement) {
                    title = titleElement.innerText.trim();
                }

                // Ищем элемент с ценой внутри контейнера
                // Судя по видео, цена находится в span.price-info__current-price
                const priceElement = cardContainer.querySelector('span.price-info__current-price');
                let price = 'Цена не найдена';
                if (priceElement) {
                    price = priceElement.innerText.trim();
                }

                // --- ПАРСИМ ВСЕ ИЗОБРАЖЕНИЯ ---
                // Ищем все элементы img внутри контейнера
                const imgElements = cardContainer.querySelectorAll('img.hotel-card__image');
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
            let coords = [55.0, 37.0]; // Фиктивные координаты по умолчанию

            // Извлекаем data-marker-id из текущего .custom-marker
            const markerId = await customMarkers[i].evaluate(el => el.getAttribute('data-marker-id'));
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

            // --- ЗАКРЫТИЕ КОНТЕЙНЕРА С КАРТОЧКАМИ ---
            // Ищем кнопку закрытия (обычно это крестик в правом верхнем углу контейнера)
            // Может быть button, svg или div с классом .close, .close-button
            const closeButton = await page.$('.card.fixed .close, .popup .close, .modal .close, .close-button');
            if (closeButton) {
                await closeButton.click();
                console.log('Контейнер с карточками закрыт.');
            } else {
                console.warn('Кнопка закрытия контейнера не найдена.');
                // Альтернатива: клик по фону карты (может не сработать)
                // await page.click('body');
            }

            // Делаем паузу между кликами, чтобы дать времени на закрытие контейнера
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
