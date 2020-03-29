// FarmBotJS requires a global atob() function for
// decoding tokens. In NodeJS, we must add a polyfill.
// To learn more about the issue, see:
//   https://github.com/FarmBot/farmbot-js/issues/33
global.atob = require("atob");

// Now that we have access to atob(), we can load
// FarmbotJS, a Farmbot client.
// NodeJS uses CommonJS modules. You can learn more
// about CommonJS here:
//   https://flaviocopes.com/commonjs/

// The first library we will load is FarmBotJS.
// Using FarmBotJS is a smart idea because it is
// the same wrapper library used by FarmBot, Inc.
// to control FarmBot. Using it ensures that your
// application will remain compatibile with future
// FarmBot OS versions.
//
// Learn more about it here:
//   https://github.com/FarmBot/farmbot-js
const Farmbot = require("farmbot").Farmbot;

// We will need an HTTP client in order to create
// a FarmBot authorization token.
// Learn more about tokens here:
//   https://developer.farm.bot/docs/rest-api#section-generating-an-api-token
// Learn more about Axios the HTTP client here:
//   https://github.com/axios/axios
const axios = require("axios"),
post = axios.post;

// Now that we have loaded all the third party libraries,
// Let's store some application config as constants.
// We need this information to create an auth token
// and also to log in to the FarmBot server so that
// we can remote control the device.
const PASSWORD = process.env.FARMBOT_PASSWORD;
const EMAIL = process.env.FARMBOT_EMAIL;
const SERVER = process.env.FARMBOT_SERVER || "https://my.farm.bot";

// We will also store some application state in an
// object known as "APPLICATION_STATE".
const APPLICATION_STATE = {
  // This object will be populated later,
  // after we connect to the server.
  // Please see the FarmBotJS documentation for
  // more information about what the FarmBot object
  // can do.
  farmbot: undefined,
  // This application is trivial- it just moves the
  // Z-axis up and down. We will keep track of that
  // here.
  direction: "down",
  // The correct way to track FarmBot's busy state
  // is via Javascript "Promises". Promises are beyond
  // the scope of this example, so we will just use
  // a simple boolean flag.
  // If you don't know what promises are, YouTube
  // tutorials are a good place to start.
  // Promises are tricky to learn at first, but
  // will make your code very clean once you understand
  // them.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise
  busy: false,
  token: null
};


//Récupère les données du capteur d'humidité, affiche et renvoit la dernière valeur
function soilSensor(){
  var valeur=0;
  APPLICATION_STATE.farmbot.readPin({pin_number: 59, pin_mode: 0}).catch(function(erreur){
      console.log(erreur);
  });

  return axios.get("https://my.farm.bot/api/sensor_readings", { 'headers': { 'Authorization': APPLICATION_STATE.token } } ).then((res) => {
      var i = 1;
      while(res.data[res.data.length-i].pin!=59){
        i++;
      }
      console.log(res.data[res.data.length-i].value);
      valeur=res.data[res.data.length-i].value;
      return valeur;
  });
}

//Retourne un tableau contenant les informations sur toutes les plantes (dont la position qui va nous intéresser)
function PlantArray(){
  var tab = [];
  return axios.get("https://my.farm.bot/api/points", { 'headers': { 'Authorization': APPLICATION_STATE.token } } ).then((res) => {
      for(let i=0; i<res.data.length; i++){
        if(res.data[i].pointer_type == 'Plant'){
          tab.push(res.data[i]);
        }
      }
      return tab;
    });
}

//Positionne le robot en (x,y,z)
//il faut mettre un return je crois
function goTo(x,y,z){
  APPLICATION_STATE.farmbot.moveAbsolute({x: x, y: y, z: z});
}

//Positionne le robot au-dessus de la ième plante 
async function goToPlant(i){
  var plantes = await PlantArray();
  var x = plantes[i].x;
  var y = plantes[i].y;
  await goTo(x,y,0);
}

//Pour l'instant essai avec le pin 7 (LED)
function water(time){
  APPLICATION_STATE.farmbot.writePin({pin_number: 7, pin_mode: 0, pin_value: 1});
  function stopWater(){
    APPLICATION_STATE.farmbot.writePin({pin_number: 7, pin_mode: 0, pin_value: 0})
  }
  setTimeout(stopWater, time);
}


//Monte l'outil tamis pour arroser sur la tête
//id de l'outil watering nozzle : 7043
function mountWateringNozzle(){
  return axios.get("https://my.farm.bot/api/sequences", { 'headers': { 'Authorization': APPLICATION_STATE.token } } ).then((res) => {
    APPLICATION_STATE.farmbot.execSequence(24863);
    return res.data;
  });
}


//A faire avec les sequences
//Remet l'outil à sa place puis homing
//Bug avec les fonctions asynchrones
async function unmountWateringNozzle(){
  await goTo(100,429,-385);
  await goTo(10,429,-385);
  await goTo(10,429,0);
  await APPLICATION_STATE.farmbot.home({axis: "x", axis: "y",axis: "z", speed: 800});
}



//Renvoit un tableau contenant l'intensité des précipitations des 12 prochaines heures
function precipIntensity(){
  return axios.get("https://api.darksky.net/forecast/83a42c27e8d21e20e138b4691e6aa8d3/42.3601,-71.0589").then((res) => {
    var tabPrecip = [];
    for(let i=0; i<12; i++){
      tabPrecip[i] = res.data.hourly.data[i].precipIntensity;
    }
    return tabPrecip;
  });
}

//Renvoit un tableau contenant l'intensité multipliée par la probabilité de précipitation des 12 prochaines heures
function precipIntensityProba(){
  return axios.get("https://api.darksky.net/forecast/83a42c27e8d21e20e138b4691e6aa8d3/42.3601,-71.0589").then((res) => {
    var tabPrecipProba = [];
    for(let i=0; i<12; i++){
      tabPrecipProba[i] = res.data.hourly.data[i].precipIntensity*res.data.hourly.data[i].precipProbability;
    }
    return tabPrecipProba;
  })
}

//Renvoit (besoin en eau) - (addition des précipitations des 12 prochaines heures) 
//à ajuster et à voir en fonction du nombre d'arrosage par jour
async function howMuchWatering(need){
  var tab = await precipIntensityProba();
  var precip = 0;
  for(let i=0; i<tab.length; i++){
    precip+=tab[i];
  }
  var res = need-precip;
  if(res<0){
    return 0;
  } else {
    return res;
  }
}

// The function below will be used to extract a JSON
// Web Token (JWT) from the Farmbot server. It is
// a callback that will be used by an HTTP POST
// request by Axios later. Continue reading to learn more.
const tokenOK = (response) => {
  console.log("GOT TOKEN: " + response.data.token.encoded);
  APPLICATION_STATE.token = response.data.token.encoded;
  return response.data.token.encoded;
};

// This is a generic error handler. We will use it
// to catch miscellaneous "promise rejections".
// Check out egghead.io and YouTube to learn more
// about Javascript promises.
const errorHandler = (error) => {
  console.log("=== ERROR ===");
  console.dir(error);
};

// This function will perform an HTTP post and
// resolve a promise that contains a FarmBot auth
// token (string).
// Call this function with an email and password
const createToken = (email, password) => {
  const payload = { user: { email, password } };
  return post(SERVER + "/api/tokens", payload).then(tokenOK);
};

// This function is called exactly once at the start
// of the application lifecycle.
const start = () => {
  // Perform an HTTP reqeust to create a token:
  return createToken(EMAIL, PASSWORD)
    // Pass the token to FarmBotJS so that we
    // can connect ot the server:
    .then((token) => {
      // Set the global FarmBot object instance for the entire app.
      APPLICATION_STATE.farmbot = new Farmbot({ token: token });
      // Were ready to connect!
      return APPLICATION_STATE.farmbot.connect();
    })
    // Once we are connected to the server,
    // we can display a helpful message.
    .then(() => { console.log("CONNECTED TO FARMBOT!"); })
    // If anything goes wrong, throw the error to
    // our error handler function.
    .catch(errorHandler);
};

// This is the main loop of the application.
// It gets called every 3,000 ms.
// You don't need to do it like this in a real app,
// but it is good enough for our purposes.
const loop = () => {
  // Perform busy handling.
  // This is to prevent sending too many commands.
  // In a real world application, you should use
  // promises.
  if (APPLICATION_STATE.busy) {
    console.log("Busy. Not running loop.");
    return;
  } else {
    console.log("Move Z Axis " + APPLICATION_STATE.direction);
    APPLICATION_STATE.busy = true;
  }

  // Are we moving the z-axis up, or down?
  if (APPLICATION_STATE.direction == "up") {
    // Move the bot up.
    APPLICATION_STATE
      .farmbot
      .moveRelative({ x: 0, y: 0, z: 20 })
      .then(() => {
        APPLICATION_STATE.direction = "down";
        APPLICATION_STATE.busy = false;
      })
      .catch(errorHandler);
  } else {
    // Move the bot down.
    APPLICATION_STATE
      .farmbot
      .moveRelative({ x: 0, y: 0, z: -20 })
      .then(() => {
        APPLICATION_STATE.direction = "up";
        APPLICATION_STATE.busy = false;
      })
      .catch(errorHandler);
  }
};

// OK. Everything is ready now.
// Let's connect to the server and start the main
// loop.
// I've added a quick "safety check" in case
// `.env` is missing:
var main = async () => {
if (PASSWORD && EMAIL) {
  // It is important to use promises here-
  // The run loop won't start until we are finished
  // connecting t the server. If we don't do this,
  // the app might try to send commands before we
  // are connected to the server
  await start();
  // setInterval will call a function every X milliseconds.
  // In our case, it is the main loop.
  // https://www.w3schools.com/jsref/met_win_setinterval.asp

  //await setInterval(loop, 3000);
  //await soilSensor();
  //console.log("intensity");
  //await precipIntensity();
  //console.log("intensity+proba");
  //await precipIntensityProba()
  //var res = await howMuchWatering(2);
  //console.log(res);
  //await goToPlant(5);
  //await water(5000);
  await mountWateringNozzle();
  //await unmountWateringNozzle();
  

} else {
  // You should not see this message if your .env file is correct:
  throw new Error("You did not set FARMBOT_EMAIL or FARMBOT_PASSWORD in the .env file.");
}
};

main();

// That's the end of the tutorial!
// The most important next step is to learn FarmBotJS.
// It has everything you need to control a FarmBot remotely.
// Learn more at:
//   https://github.com/FarmBot/farmbot-js
