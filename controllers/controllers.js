const { pool } = require("../config/db-config");
const axios = require('axios');
const FormData = require('form-data');
const { Readable } =  require('stream');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
require('dotenv').config();

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
  const chunkDuration = 15 * 60; // 5 minutes in seconds
  const numChunks = Math.ceil(duration / chunkDuration);

  // Create the output directory if it doesn't exist
  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  let transcriptions = [];

  // Use a loop to split the audio file into chunks
  for (let currentChunk = 1; currentChunk <= numChunks; currentChunk++) {
    const startOffset = (currentChunk - 1) * chunkDuration;
    const outputFileName = path.join(outputDirectory, `chunk${currentChunk}.mp3`);

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
  const chunkDuration = 5 * 60; // 5 minutes in seconds
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
  
    formData.append('file', audioStream, { filename: 'audio.mp3' });
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
      const audioFilePath = path.join(outputDirectory, 'input.mp3');
      fs.writeFileSync(audioFilePath, audioFile.buffer);

      // Split and transcribe the audio
      const transcription = await splitAndTranscribeAudio({ path: audioFilePath }, outputDirectory);

      // Clean up temporary files if needed
      fs.unlinkSync(audioFilePath);
      fs.rmdirSync(outputDirectory, { recursive: true });

      console.log('Finished splitting and transcribing.');
      res.json({ transcription });
    } else {
      console.log('Audio file size is within the acceptable range. Transcribing...');
      
      const formData = new FormData();
      const audioStream = bufferToStream(audioFile.buffer);
      formData.append('file', audioStream, { filename: 'audio.mp3', contentType: audioFile.mimetype });
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
      const {id,transcription,sum,todosList,p,flag,c} = req.body;
      const u=1;
      // Use your database pool/connection to insert the data into the data_table
      const query = `
        INSERT INTO data_table (uid,transcript,summary,todos,purpose,flag,contributor1_id)
        VALUES ($1, $2, $3,$4,$5,$6,$7)
        RETURNING data_id;
      `;
      const values = [id,transcription, sum,todosList,p,flag,c];
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
      SELECT uid, transcript, summary, todos, purpose, timestamp
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
    const audioFile = req.file;
    
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
      fs.rmdirSync(outputDirectory, { recursive: true });

      console.log('Finished splitting and transcribing.');
      res.json({ transcription });
    } else {
      console.log('Audio file size is within the acceptable range. Transcribing...');
      
      const formData = new FormData();
      formData.append('file', audioFile.buffer, { filename: 'audio.wav', contentType: 'audio/wav' });
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

  // Now send the transcription to OpenAI API to create a summary
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo-16k",
        messages: [{"role": "system", "content": "You are an analyst at a Game Studio, You read all the reviews given to the games from the Play Store or App Store. You analyse these reviews and give a recommendation to the founder/developers as to what should be the next steps into improving the game."}, {role: "user", content: `${comments}`}],
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
        model: "gpt-3.5-turbo-16k",
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
        model: "gpt-3.5-turbo-16k",
        messages: [{"role": "system", "content": "You are a secretary that deeply reads and understands text transcriptions created by whisper, You summarise the text without missing any crucial points and create a summary."}, {role: "user", content: `${transcription}`}],
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


//Route to generate Action Items 
const todos= async (req, res) => {
  try {
    const { transcription } = req.body;

    // Now send the transcription to OpenAI API to create a summary
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo-16k",
        messages: [{"role": "system", "content": "You are a secretary that deeply reads and understands text transcriptions created in online meetings, You don't miss any points, and create a list of tasks that are suppposed to be done. Each task should be on a new line and should not be numbered."}, {role: "user", content: `${transcription}`}],
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
    // Export other controller functions as needed
  };
