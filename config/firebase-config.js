var admin = require("firebase-admin");

var serviceAccount = require("./gamepac-ai-firebase-adminsdk-cxitu-e13327bdb8.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

module.exports=admin;