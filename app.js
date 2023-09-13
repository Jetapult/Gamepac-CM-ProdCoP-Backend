
const express = require('express');
const cors = require('cors');
const app = express();
const fs=require('fs');
const authMiddleware=require('./middlewares/index')
const middleware=require('./middlewares/index')
require('dotenv').config();

const routes =require('./routes/routes');
const port = process.env.PORT || 8080;
app.use(cors());
app.use(express.json());
// app.use(middleware.decodeToken);

app.use('/', routes);
app.get('/.well-known/pki-validation/FAB08B4EBE7D658763415829B79D02D8.txt',(req,res)=>{
  res.sendFile('/Users/snehalshyamsukha/Desktop/Snehal/Gamepac-Backend/server/FAB08B4EBE7D658763415829B79D02D8.txt');
})
app.get('/',(req,res) =>{
return res.json("Hello from server")
})
app.get('/message',(req,res)=>{
  return res.json("message from server")
})
app.listen(port, () => {
    console.log(`Server is running on port ${port}.`);
  });