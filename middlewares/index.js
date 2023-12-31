const admin=require('../config/firebase-config')

class Middleware{

  async decodeToken(req,res,next){
   const token=req.headers.authorization.split(' ')[1];
    try{
      const decodeValue= await admin.auth().verifyIdToken(token);
      // console.log(decodeValue);
      console.log("token decoded");
    if(decodeValue){
      return next();
    }
    return res.json({message: "Unauthorized"})
  }catch(e){
    return res.json(e);
  }
}
}

module.exports=new Middleware();