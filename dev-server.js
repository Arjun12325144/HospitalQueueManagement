require('dotenv').config();
require('./api/index').listen(3000, () => console.log('API on http://localhost:3000'));
