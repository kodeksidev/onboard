const express = require('express');
const userRoutes = require('./routes/user-routes');

const app = express();
app.use('/users', userRoutes);

app.listen(3000, () => {
  console.log('node-express fixture listening on 3000');
});
