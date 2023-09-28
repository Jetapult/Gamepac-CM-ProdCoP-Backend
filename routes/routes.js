const express = require('express');
const router = express.Router();
const controller=require('../controllers/controllers');
const multer=require('multer');
const middleware=require('../middlewares/index');
const  upload  =  multer();


router.post('/api/login',controller.login);
router.post('/data',controller.saveData);
router.post('/recorder',upload.single('file'),controller.recorder);
router.post('/transcribe', middleware.decodeToken,upload.single('file'),controller.transcribe);
router.post('/smartTranscribe',controller.smartActions); 
router.post('/replyAssistant', controller.replyAssistant);
router.post('/summary',middleware.decodeToken,controller.summary);
router.post('/todos',middleware.decodeToken,controller.todos);
router.post('/title',middleware.decodeToken,controller.title);



router.get('/data/:id',controller.getData);
router.get('/user/:uid',controller.userData);
router.get('/users',controller.getUsers);


module.exports = router;