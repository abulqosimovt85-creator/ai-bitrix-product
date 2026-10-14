// Checks the real AI request/response handling against a fake OpenAI-compatible endpoint.
const http = require('http');
let seen;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d).on('end', () => {
    seen = { auth: req.headers.authorization, path: req.url, body: JSON.parse(b) };
    const answer = '```json\n' + JSON.stringify({
      products: [
        { name: 'Test X1', description: 'Прибор X1\nМодель: X1', price: '1 200,50', currency: 'usd', measure: 'шт.',
          properties: { 'Поставщик': 'ACME', 'Условия поставки': 'FOB' }, image_urls: ['https://a.com/p.jpg', 'https://evil.com/made-up.jpg'], notes: '' },
        { name: 'Test X2', description: 'Прибор X2', image_urls: [] },
      ],
      notes: '',
    }) + '\n```';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
}).listen(4100, async () => {
  Object.assign(process.env, { AI_BASE_URL: 'http://localhost:4100/v1', AI_API_KEY: 'sk-test', AI_MODEL: 'test-model' });
  const { draftFromSource } = require('../src/ai');
  const meta = { properties: [{ id: '108', name: 'Поставщик', type: 'S', userType: '', values: [] }, { id: '110', name: 'Условия поставки', type: 'L', userType: '', values: [{ id: '2', value: 'FOB' }] }] };
  const result = await draftFromSource({ text: 'spec text', images: [{ dataUrl: 'data:image/png;base64,AAAA' }], imageUrls: [{ url: 'https://a.com/p.jpg', alt: '' }] }, meta);
  console.log('request path:', seen.path, '| auth:', seen.auth, '| model:', seen.body.model, '| json mode:', JSON.stringify(seen.body.response_format));
  console.log('user content parts:', seen.body.messages[1].content.map(c => c.type).join(','));
  console.log('system prompt mentions properties:', seen.body.messages[0].content.includes('"Условия поставки" (одно из: "FOB")'));
  console.log('products:', result.products.length, '| invented image link dropped:', JSON.stringify(result.products[0].image_urls));
  srv.close();
});
