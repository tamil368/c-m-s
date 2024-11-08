// config to dotenv
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const fs = require("fs");

const { google } = require("googleapis");
const Multer = require("multer");
const { JWT } = require("google-auth-library");

const userRoutes = require("./routes/userRoutes");
const orgRoutes = require("./routes/orgRoutes");
const conferenceRoutes = require("./routes/conferenceRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const User = require("./models/user");
const Conference = require("./models/conference");

const corsOptions = {
  origin: "*",
  successStatus: 200,
};

// express app
const app = express();

const multer = Multer({
  storage: Multer.diskStorage({
    destination: function (req, file, callback) {
      callback(null, `${__dirname}/papers`);
    },
    filename: function (req, file, callback) {
      callback(
        null,
        file.fieldname + "_" + Date.now() + "_" + file.originalname
      );
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

// authenticate with google
const authenticateGoogle = () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: "./key-file.json",
    scopes: "https://www.googleapis.com/auth/drive",
  });
  return auth;
};

const keyFile = require("./key-file.json");
const client = new JWT({
  email: keyFile.client_email,
  key: keyFile.private_key,
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({
  version: "v3",
  auth: authenticateGoogle(),
});

// upload to google drive
const uploadToGoogleDrive = async (file, auth) => {
  const fileMetadata = {
    name: file.originalname,
    parents: ["1ADFpHcBEnWz632M913g__xy8nuDO4fkz"], // Change it according to your desired parent folder id
  };

  const media = {
    mimeType: file.mimetype,
    body: fs.createReadStream(file.path),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: "id",
  });
  return response;
};

const deleteFile = (filePath) => {
  fs.unlink(filePath, () => {
    console.log("file deleted");
  });
};

// middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use((req, res, next) => {
  console.log(req.path, req.method);
  next();
});

// routes
app.use("/auth/user", userRoutes);
app.use("/auth/org", orgRoutes);
app.use("/org", conferenceRoutes);
// app.use("/upload", uploadRoutes);

app.post("/upload/", multer.single("file"), async (req, res) => {
  const { email, confid } = req.query;
  const auth = authenticateGoogle();
  const response = await uploadToGoogleDrive(req.file, auth);
  deleteFile(req.file.path);
  const user = await User.findOne({ email });
  user.papers.push({
    title: req.body.originalname,
    fileUrl: response.data.id,
    filename: req.file.originalname,
    conference: confid,
  });
  console.log(response.data.id);
  await user.save();
  const conference = await Conference.findById(confid);
  conference.papers.push({
    title: req.body.originalname,
    fileUrl: response.data.id,
    filename: req.file.originalname,
    user: user._id,
  });
  await conference.save();
  res.status(200).json({ response });
});

app.get("/files/:id", async (req, res) => {
  const { id } = req.params;
  let downloadUrl = "";
  drive.files.get(
    {
      fileId: id,
      fields: "id,name,webContentLink",
    },
    (err, resp) => {
      if (err) throw new Error("Error retrieving file metadata");

      const { id, name, webContentLink } = resp.data;
      console.log(`Retrieved file metadata for ${name} with ID ${id}`);

      // Send a GET request to the file's download URL to download the file
      downloadUrl = webContentLink.replace(/\/view\?usp=sharing$/, "");

      console.log(downloadUrl);
      const options = {
        method: "GET",
        headers: {
          Authorization: `Bearer ${client.credentials.access_token}`,
          "Access-Control-Allow-Origin": "*", // Required for CORS support to work
        },
      };
      res.json({ downloadUrl, options });
    }
  );
});

// connect to mongodb
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    // listen for requests
    if (!module.parent) {
      app.listen(process.env.PORT, () => {
        console.log("connected to db & listening on port", process.env.PORT);
      });
    }
  })
  .catch((error) => {
    console.log(error);
  });

module.exports = app;
