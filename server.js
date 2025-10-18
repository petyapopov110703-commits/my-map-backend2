const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 10000;

// Промежуточное ПО для CORS (если нужно)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Промежуточное ПО для парсинга JSON
app.use(express.json());

// --- Функция для автоматического парсинга ---
let cachedData = null;
let lastFetchTime = null;

async function fetchDataAndCache() {
  console.log('Запуск автоматического парсинга...');

  let browser;
  try {
    // Запуск браузера с использованием @sparticuz/chromium
    browser = await puppeteer.launch({
      executablePath: await chromium.executablePath(), // Путь к Chromium
      args: [...chromium.args, '--disable-web-security'], // Аргументы для серверной среды
      defaultViewport: chromium.defaultViewport,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Пример: переход на сайт и извлечение данных
    await page.goto('https://example.com', { waitUntil: 'networkidle2' }); // Замените на ваш URL

    // Пример извлечения данных
    const data = await page.evaluate(() => {
      // Пример: извлечение заголовка
      const title = document.querySelector('h1')?.innerText;
      return { title };
    });

    // Обновление кэша
    cachedData = data;
    lastFetchTime = new Date();

    console.log('Данные успешно получены и закэшированы:', data);

  } catch (error) {
    console.error('Ошибка при автоматическом парсинге:', error.message);
    // Можно оставить старые данные, если они были
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// --- Маршрут для получения кэшированных данных ---
app.get('/data', (req, res) => {
  if (cachedData) {
    res.json({
      success: true,
      data: cachedData,
      lastFetched: lastFetchTime,
    });
  } else {
    res.status(204).json({
      success: false,
      message: 'Данные еще не были получены.',
      lastFetched: lastFetchTime,
    });
  }
});

// --- Маршрут для ручного запуска парсинга ---
app.post('/fetch', async (req, res) => {
  try {
    await fetchDataAndCache();
    res.json({
      success: true,
      message: 'Парсинг завершен.',
      lastFetched: lastFetchTime,
    });
  } catch (error) {
    console.error('Ошибка при ручном парсинге:', error.message);
    res.status(500).json({
      success: false,
      message: 'Произошла ошибка при парсинге.',
      error: error.message,
    });
  }
});

// --- Запуск сервера ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);

  // Запуск автоматического парсинга при старте сервера
  fetchDataAndCache();
});
