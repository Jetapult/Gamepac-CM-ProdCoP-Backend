const { pool } = require("../config/db-config");
const axios = require('axios');
const FormData = require('form-data');
const { Readable } =  require('stream');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
require('dotenv').config();
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cron = require('node-cron');

const bucket_name=process.env.AWS_BUCKET_NAME
const bucket_region=process.env.AWS_BUCKET_REGION
const bucket_access_key=process.env.AWS_ACCESS_KEY
const bucket_secret_key=process.env.AWS_SECRET_ACCESS_KEY

function generateJwt(keyId, issuerId, privateKey) {
  const header = {
    alg: 'ES256',
    kid: keyId,
    typ: 'JWT'
  };

  const payload = {
    iss: issuerId,
    exp: Math.floor(Date.now() / 1000) + (20 * 60), // 20 minutes
    aud: 'appstoreconnect-v1'
  };

  return jwt.sign(payload, privateKey, { header: header });
}
const privateKey = fs.readFileSync('./AuthKey_QN33C4AAK9.p8').toString();
const keyId = process.env.APPLE_KEY_ID;
const issuerId = process.env.APPLE_ISSUER_ID;



const s3 = new S3Client({
  credentials: {
    accessKeyId:bucket_access_key,
    secretAccessKey:bucket_secret_key
  },
  region:bucket_region,
})
// retrieve the aws s3 link 
const bufferToStream = (buffer) => {
  return Readable.from(buffer);
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function splitAndTranscribeAudio(input, outputDirectory) {
  // Get the duration of the audio file in seconds
  const duration = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input.path, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });

  // Calculate the number of chunks
  const chunkDuration = 20 * 60; // 20 minutes in seconds
  const numChunks = Math.ceil(duration / chunkDuration);

  // Create the output directory if it doesn't exist
  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  let transcriptions = [];

  // Use a loop to split the audio file into chunks
  for (let currentChunk = 1; currentChunk <= numChunks; currentChunk++) {
    const startOffset = (currentChunk - 1) * chunkDuration;
    const outputFileName = path.join(outputDirectory, `chunk${currentChunk}${path.extname(input.path)}`);

    await new Promise((resolve, reject) => {
      ffmpeg(input.path)
        .setStartTime(startOffset)
        .setDuration(chunkDuration)
        .output(outputFileName)
        .on('end', async () => {
          console.log(`Chunk ${currentChunk} saved as ${outputFileName}`);
          const transcription = await transcribeAudioChunk(outputFileName);
          console.log(`Transcription of chunk ${currentChunk}: ${transcription}`);
          transcriptions.push(transcription);
          resolve();
        })
        .on('error', (err) => {
          console.error(`Error processing chunk ${currentChunk}: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  return transcriptions.join(' ');
}
async function splitAndTranscribeRecorderAudio(input, outputDirectory) {
  // Get the duration of the audio file in seconds
  const duration = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input.path, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });

  // Calculate the number of chunks
  const chunkDuration = 1 * 60; // 5 minutes in seconds
  const numChunks = Math.ceil(duration / chunkDuration);

  // Create the output directory if it doesn't exist
  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  let transcriptions = [];

  // Use a loop to split the audio file into chunks
  for (let currentChunk = 1; currentChunk <= numChunks; currentChunk++) {
    const startOffset = (currentChunk - 1) * chunkDuration;
    const outputFileName = path.join(outputDirectory, `chunk${currentChunk}.wav`);

    await new Promise((resolve, reject) => {
      ffmpeg(input.path)
        .setStartTime(startOffset)
        .setDuration(chunkDuration)
        .output(outputFileName)
        .on('end', async () => {
          console.log(`Chunk ${currentChunk} saved as ${outputFileName}`);
          const transcription = await transcribeRecorderChunk(outputFileName);
          console.log(`Transcription of chunk ${currentChunk}: ${transcription}`);
          transcriptions.push(transcription);
          resolve();
        })
        .on('error', (err) => {
          console.error(`Error processing chunk ${currentChunk}: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  return transcriptions.join(' ');
}

async function transcribeAudioChunk(audioFilePath) {
  try {
    const formData = new FormData();
    const audioStream = fs.createReadStream(audioFilePath);
  
    formData.append('file', audioStream, { filename: 'audio' + path.extname(audioFilePath), contentType: 'audio/' + path.extname(audioFilePath).substring(1) });
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');
  
    const config = {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    };
  
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, config);
    return response.data.text;
  } catch (error) {
    console.error(`Error transcribing chunk from ${audioFilePath}: ${error.message}`);
  }

}
async function transcribeRecorderChunk(audioFilePath) {
  try {
    const formData = new FormData();
    const audioStream = fs.createReadStream(audioFilePath);
  
    formData.append('file', audioStream, { filename: 'audio.wav', contentType: 'audio/wav' }); // specify the format as .wav
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');
  
    const config = {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    };
  
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, config);
    return response.data.text;
  } catch (error) {
    console.error(`Error transcribing chunk from ${audioFilePath}: ${error.message}`);
  }

}

const transcribe = async (req, res) => {
  try {
    const audioFile = req.file;
    console.log(req.file);
    const params={
      Bucket:bucket_name,
      Key: req.file.originalname,
      Body:req.file.buffer,
      ContentType:req.file.mimetype,
    }
    const command=new PutObjectCommand(params)
    await s3.send(command);
    if (!audioFile) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const fileSizeInMB = audioFile.size / (1024 * 1024); // Convert to MB
    console.log(`Uploaded audio file size: ${fileSizeInMB} MB`);

    if (fileSizeInMB > 25) {
      console.log('Audio file size is greater than 25 MB. Splitting and transcribing...');

      // Create a temporary output directory
      const outputDirectory = 'temp_chunks';
      if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
      }

      // Write the buffer to a file
      const audioFilePath = path.join(outputDirectory, 'input' + path.extname(audioFile.originalname));
      fs.writeFileSync(audioFilePath, audioFile.buffer);

      // Split and transcribe the audio
      const transcription = await splitAndTranscribeAudio({ path: audioFilePath }, outputDirectory);

      // Clean up temporary files if needed
      fs.unlinkSync(audioFilePath);
      fs.rmSync(outputDirectory, { recursive: true });

      console.log('Finished splitting and transcribing.');
      res.json({ transcription });
    } else {
      console.log('Audio file size is within the acceptable range. Transcribing...');
      
      const formData = new FormData();
      const audioStream = bufferToStream(audioFile.buffer);
      formData.append('file', audioStream, { filename: 'audio' + path.extname(audioFile.originalname), contentType: audioFile.mimetype });
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'json');
      
      const config = {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
      };

      // Call the OpenAI Whisper API to transcribe the audio
      const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, config);
      const transcription = response.data.text;
      res.json({ transcription });

      console.log('Finished transcribing.');
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error transcribing audio' });
  }
};

// API endpoint for user login (also handles adding unique users to the "User" table)
const login=async (req, res) => {
    try {
      const { email, uid, name} = req.body;
      // Validate the user information (you can add more validation as needed)
      if (!email || !uid || !name) {
        return res.status(400).json({ error: 'Credentials Required' });
      }
      // Check if the user already exists in the "User" table
      const checkUserQuery = 'SELECT * FROM "users" WHERE uid = $1';
      const checkUserValues = [uid];
      const userResult = await pool.query(checkUserQuery, checkUserValues);
  
      if (userResult.rows.length > 0) {
        // User already exists, return the existing user data
        const existingUser = userResult.rows[0];
        return res.status(200).json(existingUser);
      }
  
      // Insert the user into the "User" table if it's a new user
      const insertUserQuery = 'INSERT INTO "users" (uid,email,name) VALUES ($1, $2,$3) RETURNING *';
      const insertUserValues = [uid,email, name];
  
      const insertResult = await pool.query(insertUserQuery, insertUserValues);
      const newUser = insertResult.rows[0];
      res.status(201).json(newUser);
    } catch (error) {
      console.error('Error logging in:', error);
      res.status(500).json({ error: 'Error logging in' });
    }
  };


  //Save the data
  const saveData= async (req, res) => {
    console.log(req.body);
    try {
      const {id,transcription,sum,todosList,p,flag,c,title} = req.body;
      const u=1;
      // Use your database pool/connection to insert the data into the data_table
      const query = `
        INSERT INTO data_table (uid,transcript,summary,todos,purpose,flag,contributor1_id,title)
        VALUES ($1, $2, $3,$4,$5,$6,$7,$8)
        RETURNING data_id;
      `;
      const values = [id,transcription, sum,todosList,p,flag,c,title];
      const result = await pool.query(query, values);
      // Extract the generated actionId from the result
      const actionId = result.rows[0].data_id;
      res.json({ actionId });
      console.log(actionId);
    } catch (error) {
      console.error('Error saving data:', error);
      res.status(500).json({ error: 'Error saving data' });
    }
  };

//Route to get Data wrt Action Id
const getData= async (req, res) => {
  try {
    const dataId = req.params.id;

    // Use your database pool/connection to fetch data for the given data_id
    const query = `
      SELECT uid, transcript, summary, todos, purpose, timestamp,title
      FROM data_table
      WHERE data_id = $1;
    `;
    const values = [dataId];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Data not found' });
    }

    const data = result.rows[0];
    res.json(data);
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: 'Error fetching data' });
  }
};

//Get User Data wrt to uid
const userData= async (req, res) => {
  try {
    const uid = req.params.uid;
    // Use your database pool/connection to fetch all data for the given user
    const query=`
    SELECT dt.*, u_uploader.name AS uploader_name, u_contributor.name AS contributor_name
    FROM data_table dt
    LEFT JOIN users u_uploader ON dt.uid = u_uploader.uid
    LEFT JOIN users u_contributor ON dt.contributor1_id = u_contributor.uid
    WHERE dt.uid = $1 OR dt.contributor1_id = $1;
    `
    const values = [uid];
    const result = await pool.query(query, values);

    const data = result.rows;
    res.json(data);
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: 'Error fetching data' });
  }
};

//Get all Users in the System
const getUsers=async(req,res)=>{
  console.log(req.headers);
  try{
    const query="SELECT uid,name,email from users";
    const result=await pool.query(query);
    const data=result.rows;
    res.json(data);
  }catch(error){
    console.error("Error fetching users",error);
    res.status(500).json({ error: 'Error fetching data' });
  }
}

//Route to get transcriptions for offline recording
const recorder = async (req, res) => {
  try {
    const {s3Key} = req.body;
    console.log(s3Key)
    const params={
      Bucket:bucket_name,
      Key: s3Key
    }
    // Create a new GetObjectCommand with the parameters
    const command = new GetObjectCommand(params)
    const { Body }= await s3.send(command);
    const audioFile = Body;
    console.log(audioFile);
    if (!audioFile) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const fileSizeInMB = audioFile.size / (1024 * 1024); // Convert to MB

    if (fileSizeInMB > 25) {
      console.log('Audio file size is greater than 25 MB. Splitting and transcribing...');

      // Create a temporary output directory
      const outputDirectory = 'temp_chunks';
      if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
      }

      // Write the buffer to a file
      const audioFilePath = path.join(outputDirectory, 'input.wav');
      fs.writeFileSync(audioFilePath, audioFile.buffer);
      // Split and transcribe the audio
      const transcription = await splitAndTranscribeRecorderAudio({ path: audioFilePath }, outputDirectory);

      // Clean up temporary files if needed
      fs.unlinkSync(audioFilePath);
      fs.rmSync(outputDirectory, { recursive: true });

      console.log('Finished splitting and transcribing.');
      res.json({ transcription });
    } else {
      console.log('Audio file size is within the acceptable range. Transcribing...');
      
      const formData = new FormData();
      formData.append('file', audioFile, { filename: 'audio.wav', contentType: 'audio/wav' });
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'json');
      
      const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
      });

      res.json({ transcription: response.data.text });
    }
  } catch (error) {
    console.error('Error transcribing audio:', error);
    res.status(500).json({ error: 'An error occurred while transcribing audio' });
  }
};


//Route to generate smart actions depending on community reviews
const smartActions = async(req,res)=>{
  try {
    const { comments,game } = req.body;
    console.log(req.body);

  // Now send the transcription to OpenAI API to create a summary
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4-1106-preview",
        messages: [{"role": "system", "content": "You are an expert analyst at a Game Studio, You read all the reviews given to the games from the Play Store or App Store, deeply understand all relevant reviews good and bad. You analyse these reviews and give a recommendation to the founder/developers as to what should be the next steps into improving the game. You list out all the recommendations in crisp points that are consumable and in not more than 200 words."}, {role: "user", content: `${comments}`}],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const summary = openaiResponse.data.choices[0].message.content;

    res.json({ game,summary });
  } catch (error) {
    console.error('Error generating Smart Actions', error);
    res.status(500).json({ error: 'Error generating Smart Actions' });
  }
}


//Route to fetch replies for user reviews on the game. 
const replyAssistant= async (req, res) => {
  try {
    const { comment } = req.body;

    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4-1106-preview",
        messages: [{"role": "system", "content": "You are a social Media Assistant at a game Studio and you understand the reviews and give appropriate replies to the user."}, {role: "user", content: `${comment}`}],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );
    const reply = openaiResponse.data.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error('Error generating reply:', error);
    res.status(500).json({ error: 'Error generating reply' });
  }
};

//Route to generate a summary based on transcriiption from whisper 
const summary= async (req, res) => {
  try {
    const { transcription } = req.body;
    console.log(req.headers);

    // Now send the transcription to OpenAI API to create a summary
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        "model": "gpt-4-1106-preview",
        "messages": [
          {"role": "system", "content": "You are a proficient AI with a specialty in distilling information into key points. Based on the following text, identify and list the main points that were discussed or brought up. These should be the most important ideas, findings, or topics that are crucial to the essence of the discussion. Your goal is to provide a list that someone could read to quickly understand what was talked about."},
          {"role": "user", "content": `${transcription}`}
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const summary = openaiResponse.data.choices[0].message.content;

    res.json({ summary });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: 'Error generating summary' });
  }
};
//Route to generate a title based on transcriiption from whisper 
const title= async (req, res) => {
  try {
    const { transcription } = req.body;
    console.log(req.headers);
    // Now send the transcription to OpenAI API to create a summary
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4-1106-preview",
        messages: [{"role": "system", "content": "You are a smart Title generator, read the transcript thoroughly and generate a small and crisp title not more than 5 words."}, {role: "user", content: `${transcription}`}],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );
    const title = openaiResponse.data.choices[0].message.content;
    res.json({ title });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: 'Error generating summary' });
  }
};

//Route to generate Action Items 
const todos= async (req, res) => {
  try {
    const { transcription } = req.body;

    // Now send the transcription to OpenAI API to create a summary
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4-1106-preview",
        messages: [{"role": "system","content": "You are an AI expert in analyzing conversations and extracting action items. Please review the text and identify any tasks, assignments, or actions that were agreed upon or mentioned as needing to be done. These could be tasks assigned to specific individuals, or general actions that the group has decided to take. Please list these action items clearly and concisely."}, {role: "user", content: `${transcription}`}],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const todos = openaiResponse.data.choices[0].message.content;

    res.json({ todos });
  } catch (error) {
    console.error('Error generating Todo List', error);
    res.status(500).json({ error: 'Error generating Todo List' });
  }
};

const packageNames = ['com.holycowstudio.my.home.design.makeover.games.dream.word.redecorate.masters.life.house.decorating','com.holycowstudio.my.design.home.makeover.word.house.life.games.mansion.decorate.decor.masters','com.holycowstudio.design.my.home.makeover.word.life','com.holycowstudio.homedesigndreams','com.holycowstudio.gamedevtycoon','com.holycowstudio.my.home.design.makeover.games.dream.word.redecorate.masters.life.house.decorating' ,'com.ns.idlesmartphonetycoon','com.holycowstudio.my.home.design.makeover.luxury.interiors.word.dream.million.dollar.house.renovation','com.theholycowstudio.youtubertycoon','com.holycowstudio.idle.hotel.tycoon.clicker.tap.empire.incremental.games', 'com.holycowstudio.oiltycoon2','com.holycowstudio.coffeetycoon','com.holycowstudio.mystery.island.design.match.decoration.lost.adventure','com.romit.sheikhoiltycoon','com.holycowstudio.designyourcatroom']

// Schedule a task to run every midnight
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Cron job started');
    for (const packageName of packageNames){
      // Fetch the reviews
      const reviews = await fetchCommentsFromStore(packageName);
      // Store the reviews in the database
      await storeComments(reviews, packageName);
    // Your code here
    }
    console.log('Cron job finished');

  } catch (error) {
    console.error('Error in cron job:', error);
  }
});

// This function fetches comments and can be used both in your route and in your cron job
async function fetchCommentsFromStore(packageName) {
    try {
  
      const auth = new google.auth.GoogleAuth({
        keyFile: './service-account.json',
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      });
  
      const play = google.androidpublisher({
        version: 'v3',
        auth: auth,
      });
  
      const response = await play.reviews.list({
        packageName: packageName,
        translationLanguage: 'en_GB',
      });
    if (response.data.reviews) {
      const reviews = response.data.reviews.map(review => {
        const userComment = review.comments[0].userComment;
        const deviceMetadata = userComment.deviceMetadata || {};
        return {
          reviewId: review.reviewId,
          userName: review.authorName,
          comment: userComment.text,
          date: new Date(userComment.lastModified.seconds * 1000),
          userRating: userComment.starRating,
          originalLang: userComment.originalText,
          reviewerLanguage: userComment.reviewerLanguage,
          postedReply: (review.comments.length > 1 ? review.comments[1].developerComment.text : null),
          device: userComment.device,
          androidOsVersion: userComment.androidOsVersion,
          appVersionCode: userComment.appVersionCode,
          appVersionName: userComment.appVersionName,
          thumbsUpCount: userComment.thumbsUpCount,
          thumbsDownCount: userComment.thumbsDownCount,
          deviceMetadata: {
            productName: deviceMetadata.productName,
            manufacturer: deviceMetadata.manufacturer,
            deviceClass: deviceMetadata.deviceClass,
            screenWidthPx: deviceMetadata.screenWidthPx,
            screenHeightPx: deviceMetadata.screenHeightPx,
            nativePlatform: deviceMetadata.nativePlatform,
            screenDensityDpi: deviceMetadata.screenDensityDpi,
            glEsVersion: deviceMetadata.glEsVersion,
            cpuModel: deviceMetadata.cpuModel,
            cpuMake: deviceMetadata.cpuMake,
            ramMb: deviceMetadata.ramMb
          }
        };
      });
      return reviews;
    }else{
      return [];
    }
    } catch (error) {
      console.error('Error fetching reviews:', error);
      res.status(500).json({ error: 'Error fetching reviews'});
    }
  }
  
const fetchComments = async (req, res) => {
  try {
    const packageName = req.body.packageName;
    const comments = await fetchCommentsFromStore(packageName);
    res.json(comments);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Error fetching reviews' });
  }
};

async function storeComments(reviews,packageName) {
  try {
      for (const review of reviews) {
      await pool.query(`
      INSERT INTO reviews_table (
        reviewId, 
        authorName, 
        comment, 
        date,
        userRating, 
        reviewerLanguage,
        originalLang,
        postedreply,
        device, 
        androidOsVersion, 
        appVersionCode, 
        appVersionName, 
        thumbsUpCount, 
        thumbsDownCount, 
        productName, 
        manufacturer, 
        deviceClass, 
        screenWidthPx, 
        screenHeightPx, 
        nativePlatform, 
        screenDensityDpi, 
        glEsVersion, 
        cpuModel, 
        cpuMake, 
        ramMb, 
        packageName
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
      )
      ON CONFLICT (reviewId) DO UPDATE SET
        postedreply = EXCLUDED.postedreply
      WHERE reviews_table.postedreply IS NULL AND EXCLUDED.postedreply IS NOT NULL;
    `, [
        review.reviewId, 
        review.userName, 
        review.comment, 
        review.date, 
        review.userRating, 
        review.reviewerLanguage, 
        review.originalLang,
        review.postedReply,
        review.device, 
        review.androidOsVersion, 
        review.appVersionCode, 
        review.appVersionName, 
        review.thumbsUpCount, 
        review.thumbsDownCount, 
        review.deviceMetadata.productName, 
        review.deviceMetadata.manufacturer, 
        review.deviceMetadata.deviceClass, 
        review.deviceMetadata.screenWidthPx, 
        review.deviceMetadata.screenHeightPx, 
        review.deviceMetadata.nativePlatform, 
        review.deviceMetadata.screenDensityDpi, 
        review.deviceMetadata.glEsVersion, 
        review.deviceMetadata.cpuModel, 
        review.deviceMetadata.cpuMake, 
        review.deviceMetadata.ramMb, 
        packageName
      ]);
    }

    console.log('Reviews updated successfully');
  } catch (error) {
    console.error('Error updating reviews:', error);
  }
}

//Route to get Data wrt Action Id
const getGoogleData= async (req, res) => {
  try {
    const packageName=req.body.packageName;
    // Use your database pool/connection to fetch data for the given data_id
    const query = `
      SELECT *
      FROM reviews_table
      WHERE packagename = $1;
    `;
    const values = [packageName];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Data not found' });
    }
    const data = result.rows.map(review=>({
      reviewId: review.reviewid, 
      userName: review.authorname, 
      comment: review.comment, 
      date: review.date, 
      userRating: review.userrating, 
      reviewerLanguage: review.reviewerlanguage, 
      originalLang: review.originallang,
      postedReply: review.postedreply,
      device: review.device, 
      androidOsVersion: review.androidosversion, 
      appVersionCode: review.appversioncode, 
      appVersionName: review.appversionname, 
      thumbsUpCount: review.thumbsupcount, 
      thumbsDownCount: review.thumbsdowncount, 
      productName: review.productname, 
      manufacturer: review.manufacturer, 
      deviceClass: review.deviceclass, 
      screenWidthPx: review.screenwidthpx, 
      screenHeightPx: review.screenheightpx, 
      nativePlatform: review.nativeplatform, 
      screenDensityDpi: review.screendensitydpi, 
      glEsVersion: review.glesversion, 
      cpuModel: review.cpumodel, 
      cpuMake: review.cpumake, 
      ramMb: review.rammb, 
    }))

    res.json(data);
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: 'Error fetching data' });
  }
};
const postGoogleReply=async(req,res)=>{
  try {
    const {reply,reviewId,packageName}=req.body;

    const auth = new google.auth.GoogleAuth({
      keyFile: './service-account.json',
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });

    const play = google.androidpublisher({
      version: 'v3',
      auth: auth,
    });
    const response = await play.reviews.reply({
      packageName: packageName,
      reviewId: reviewId,
      requestBody: {
        replyText: reply,
      },
    });

    res.json(response.data);

  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Error fetching reviews' });
  }
}
const postAppleReply = async (req, res) => {
  try {
    const { reviewId, reply } = req.body;

    const token = generateJwt(keyId, issuerId, privateKey);

    const response = await axios.post(
      'https://api.appstoreconnect.apple.com/v1/customerReviewResponses',
      {
        data: {
          type: 'customerReviewResponses',
          attributes: {
            responseBody: reply,
          },
          relationships:{
            review:{
              data:{
                type: "customerReviews",
                id:reviewId,
              }
            }
          }
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error posting reply:', error);
    res.status(500).json({ error: 'Error posting reply' });
  }
};

const getAppleResponse=async (req, res) => {
  try {
    const { reviewId} = req.body;

    const token = generateJwt(keyId, issuerId, privateKey);

    const response = await axios.get(
      `https://api.appstoreconnect.apple.com/v1/customerReviews/${reviewId}/response`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error posting reply:', error);
    res.status(500).json({ error: 'Error posting reply' });
  }
};

const fetchAppleComments=async (req, res) => {
  try {
    const id = req.body.appId;
    const token = generateJwt(keyId, issuerId, privateKey);
    const response = await axios.get(`https://api.appstoreconnect.apple.com/v1/apps/${id}/customerReviews?`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error fetching customer reviews' });
  }
};
// Converts local file information to a GoogleGenerativeAI.Part object.
function bufferToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType
    },
  };
}
const generateData = async(req,res)=>{
  try{
    const imageFiles = req.files;
    console.log(imageFiles) // This is the uploaded file
    console.log(req.body)
    const prompt = req.body.prompt;
    console.log(prompt)


    // Access your API key as an environment variable (see "Set up your API key" above)
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY); 

    // For text-and-image input (multimodal), use the gemini-pro-vision model
    const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

    const imageParts = imageFiles.map(file => bufferToGenerativePart(file.buffer, file.mimetype));

    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const generatedText = response.text();
    console.log(generatedText);

    res.json({ generatedText });
  }catch(error){
    console.error('Error:', error);
    res.status(500).json({ error: 'Error generating content' });
  }
}


  module.exports = {
    login,
    saveData,
    getData,
    userData,
    getUsers,
    recorder,
    transcribe,
    smartActions,
    replyAssistant,
    summary,
    todos,
    title,
    fetchComments,
    fetchAppleComments,
    postGoogleReply,
    postAppleReply,
    getAppleResponse,
    generateData,
    getGoogleData
    // Export other controller functions as needed
  };
