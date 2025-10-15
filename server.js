// Подключаем библиотеки
const express = require('express');
const puppeteer = require('puppeteer');

// Создаём веб-приложение
const app = express();
const PORT = 3000;

// Запускаем сервер
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});

// Маршрут, который будет возвращать JSON с объектами
app.get('/api/objects', async (req, res) => {
    console.log('Получен запрос на получение объектов...');

    // Запускаем "виртуальный браузер"
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        // Переходим на сайт
        await page.goto('https://homereserve.ru/BeWaidhbbl', { waitUntil: 'networkidle2' });

        // Ждём, пока появится хотя бы один элемент .hotel-card (или .hotel-card.map)
        // Попробуем оба селектора
        await page.waitForSelector('.hotel-card, .hotel-card.map', { timeout: 10000 }); // Ждём 10 секунд
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

        console.log('Найденные объекты:', objectsData);

        // Добавляем фиктивные координаты и ID
        const objects = objectsData.map((obj, index) => ({
            id: index + 1,
            title: obj.title,
            price: obj.price,
            coords: [55.0 + index * 0.001, 37.0 + index * 0.001] // Пример координат
        }));

        // Отправляем JSON клиенту
        res.json(objects);

    } catch (error) {
        console.error('Ошибка при парсинге:', error);
        if (error.name === 'TimeoutError') {
            res.status(500).json({ error: 'Таймаут: элементы .hotel-card не появились за 10 секунд.' });
        } else {
            res.status(500).json({ error: 'Не удалось получить данные' });
        }
    } finally {
        // Обязательно закрываем браузер
        if (browser) {
            await browser.close();
        }
    }
});