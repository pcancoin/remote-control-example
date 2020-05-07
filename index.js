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
      valeur=res.data[res.data.length-i].value;
      return valeur;
  });
}

//Retourne un tableau contenant les informations sur toutes les plantes (dont la position qui va nous intéresser)
function plantArray(){
  var tab = [];
  return axios.get("https://my.farm.bot/api/points", { 'headers': { 'Authorization': APPLICATION_STATE.token } } ).then((res) => {
      for(let i=0; i<res.data.length; i++){
        if(res.data[i].pointer_type == 'Plant'){
          tab.push(res.data[i]);
        }
      }
      //console.log(tab);
      return tab;
    });
}

//Calcule la distance entre 2 points de coordonnées (x,y) et (i,j)
function distance (x,y,i,j){
  var res = Math.sqrt((x-i)*(x-i) + (y-j)*(y-j));
  //console.log(res);
  return res;
}

//Renvoit la case du tableau plantArray de la plante la plus proche du point de coordonnées (x,y).
function distanceMin(x,y, plantes){
  var min = 3500;
  var planteNum = 0;
  for(let i = 0; i<plantes.length; i++){
    if(plantes[i] != -1){
      var dist = distance(x,y, plantes[i].x, plantes[i].y);
      if(dist != 0){
        if(min > dist){
          min = dist;
          planteNum = i;
        }
      }
    }
  }
  //console.log(min);
  return planteNum;
}

//Renvoit un tableau contenant les numéros des plantes dans l'ordre d'arrosage.
async function parcours(){
  var parcours = [];
  var plantes = await plantArray();
  parcours[0] = distanceMin(0,0, plantes);
  for (let i = 1; i<plantes.length; i++){
    parcours[i] = distanceMin(plantes[parcours[i-1]].x, plantes[parcours[i-1]].y, plantes);
    plantes[parcours[i-1]] = -1;
  }
  //console.log(parcours);
  return parcours;
}

//Positionne le robot en (x,y,z)
function goTo(x,y,z){
  APPLICATION_STATE.farmbot.moveAbsolute({x: x, y: y, z: z});
}

//Positionne le robot au-dessus de la ième plante 
async function goToPlant(i){
  var plantes = await plantArray();
  var x = plantes[i].x;
  var y = plantes[i].y;
  await goTo(x,y,0);
}

//allume l'electrovanne pendant le temps défini en paramètre
function water(time){
  APPLICATION_STATE.farmbot.writePin({pin_number: 8, pin_mode: 0, pin_value: 1});
  function stopWater(){
    APPLICATION_STATE.farmbot.writePin({pin_number: 8, pin_mode: 0, pin_value: 0})
  }
  setTimeout(stopWater, time);
}


//Renvoit la liste des séquences
function getSequences(){
  return axios.get("https://my.farm.bot/api/sequences", { 'headers': { 'Authorization': APPLICATION_STATE.token } } ).then((res) => {
    console.log(res.data);
    return res.data;
  });
}

//Renvoit la liste des outils
function getTools(){
  return axios.get("https://my.farm.bot/api/tools", { 'headers': { 'Authorization': APPLICATION_STATE.token } } ).then((res) => {
    console.log(res.data);
    return res.data;
  });
}


//Monte l'outil tamis pour arroser
//id de l'outil watering nozzle : 7043
function mountWateringNozzle(){
  console.log("Debut");
  return axios.get("https://my.farm.bot/api/sequences", { 'headers': { 'Authorization': APPLICATION_STATE.token } } ).then((res) => {
    APPLICATION_STATE.farmbot.execSequence(24863, [{
      kind: "parameter_application",
      args: {
        label: "parent",
        data_value: { kind: "tool", args: { tool_id: 7041 } }
      }
    }]);
    
    return res.data;
  });
}


//lance la séquence unmount tool avec l'outil prédéfini dans l'application
async function unmountWateringNozzle(){
  return axios.get("https://my.farm.bot/api/sequences", { 'headers': { 'Authorization': APPLICATION_STATE.token } } ).then((res) => {
    APPLICATION_STATE.farmbot.execSequence(24867, [{
      kind: "parameter_application",
      args: {
        label: "parent",
        data_value: { kind: "tool", args: { tool_id: 7041 } }
      }
    }]);
    return res.data;
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

//renvoit le temps d'arrosage nécessaire pour une plante
//paramètres : mm par seconde de notre pompe, et besoin en eau en ml d'une plante
async function getTime(mmPerSec, need){
  var water = await howMuchWatering(need);
  var res = water/mmPerSec;
  //console.log(res);
  return res;
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

  } else {
    // You should not see this message if your .env file is correct:
    throw new Error("You did not set FARMBOT_EMAIL or FARMBOT_PASSWORD in the .env file.");
  }
};

main();

