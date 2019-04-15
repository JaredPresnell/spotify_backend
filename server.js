require('dotenv').config();
const express = require('express');  
const bodyParser = require('body-parser');
var mongoose = require('mongoose');
const MongoClient = require('mongodb').MongoClient;
const mongo = require('mongodb');
var Schema = mongoose.Schema;
var userSchema = new Schema({
	spotifyId: {type: String, required: true, unique: true},
	name: {type: String, required: true},
	accessToken: {type: String, required: true}, 
	refreshToken: {type: String, required: true}
});
var User = mongoose.model('User', userSchema);

var tracksSchema = new Schema({
	tracks: {type: Array, required: true},
	lastUpdated: {type: Date}
});		
var Tracks = mongoose.model('tracks', tracksSchema);

const uri = "mongodb://localhost:27017/spotify";

var Spotify = require('spotify-web-api-node');
const spotifyApi = new Spotify();

const app = express();
const port = process.env.PORT || 5000;
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));		

const fetch = require('node-fetch');
var Bluebird = require('bluebird');
fetch.Promise = Bluebird;

app.get('/api/getusers', (req, res) => {
        
    mongoose.connect(uri, {useNewUrlParser: true});
	var db = mongoose.connection;
  	db.on('error', console.error.bind(console, 'connection error:'));
  	db.once('open', function(){
  		var usersArray = [];
  		User.find({}, function(err, users){
  			if(users.length==0){
  				usersArray = [{spotifyId: '', name:'',accessToken:'',refreshToken:''}]; 
  			}
  			else usersArray = users;
  			res.json(usersArray);
  		});
  		
  	});
});

app.post('/api/edituser',(req, res) => {
	mongoose.connect(uri, {useNewUrlParser: true});
	var db = mongoose.connection;
  	db.on('error', console.error.bind(console, 'connection error:'));
  	let query = {refreshToken: req.body.refreshToken};
	db.once('open', function() {
		User.findOneAndUpdate(query, {accessToken: req.body.accessToken}, {upsert: false, new: true}, 
			function(err,doc){	
				if(err) return res.send(500, {error: err});
				return res.send(doc);
		});
	});
	

});
app.post('/api/adduser', (req, res) => {
	//adds a user to the database
	//returns updated track list from database
  	mongoose.connect(uri, {useNewUrlParser: true});
  	var db = mongoose.connection;
  	db.on('error', console.error.bind(console, 'connection error:'));
	db.once('open', function() {
	  	let user = new User({
			spotifyId: req.body.spotifyId,
			name: req.body.name,
			accessToken: req.body.accessToken, 
			refreshToken: req.body.refreshToken
		});
		User.find({spotifyId: req.body.spotifyId}).then((data)=>{
			if(data.length==0){
				user.save((err, user) => {
					if (err) return console.error(err);
					console.log(user.name + 'saved to database');
					doEverything()
					.then((data)=> {
						res.json(data);
					});
				});	
			}
			else {
				res.json({message: 'user already exists in database'});
			}
			
		});
	});
});

app.get('/api/gettracks', (req, res) =>{
	mongoose.connect(uri, {useNewUrlParser: true});
  	var db = mongoose.connection;
  	db.on('error', console.error.bind(console, 'connection error:'));
  	db.once('open', function() {
		Tracks.find((err, tracks) =>{
			console.log('TRACKS');
			console.log(tracks[0]);
			if(typeof tracks[0] !== 'undefined' && tracks[0])
				res.json(tracks[0]);
			else res.json({tracks: [], lastUpdated: null});
		});
	});
});

app.get('/api/doeverything', (req, res) =>{
	mongoose.connect(uri, {useNewUrlParser: true});
	var db = mongoose.connection;
	db.once('open', ()=> {
   		doEverything();
   	});
   	res.send('doing everything');
});
app.get('/api/loadData', (req, res)=>{
	res.send('this is where Id load data');
});
app.listen(port, () => {
	console.log("Listening on port "+port);
	doEverything();
	
	function updateTimer(){
		var d = new Date();
		var day = d.getDay();
		var minutes = d.getMinutes();
		var hours = d.getHours();
		if(day==5 && hours==0){
			mongoose.connect(uri, {useNewUrlParser: true});
			var db = mongoose.connection;
			db.once('open', ()=> {
				doEverything();
			});
		}
	}
	setInterval(updateTimer, 60*30*1000);
	//friday morning maybe? not sure
	//do everything might need like a conditional really so its not just calling the db all the time?
  	

	
});	
function getUsers(){
	return User.find({}).then((users)=>{
		var tokensPromiseArray = users.map((user) =>{
			var refreshToken = user.refreshToken;
			console.log('user id: ' + user.spotifyId);
            return fetch(process.env.STAGE + 'refresh_token?refresh_token=' + refreshToken, {
        		method: 'GET',
	      	})
	 	 	.then(function(res){
	 	 		console.log(res);
	      		return res.json();
	      	});
		});
		return tokensPromiseArray;
	});
}
function updateTokens(tokensArray){
	var updateDBPromises =[];
	return updateDBPromises = tokensArray.map((token) =>{
		let accessToken = token.access_token;
		let refreshToken = token.refresh_token;
		let query = {refreshToken: refreshToken};
		return User.findOneAndUpdate(query, {accessToken: accessToken}, {upsert: false, new: true}).exec();
	});
}	
function getTracksFromSpotify(users){
	var jaredAccessToken= '';
	var totalTracks = [];
	users.forEach((user)=>{
		if(user.spotifyId==="waytoofatdolphin")
		{
			jaredAccessToken = user.accessToken;
		}
	});
	var spotifyPromises = [];
	spotifyPromises = users.map((user)=>{
		spotifyApi.setAccessToken(user.accessToken);
		const options = {limit: 5, offset: 0, time_range: 'short_term'};
	//	console.log('calling spotify');
		return spotifyApi.getMyTopTracks(options).then((data) => {
			return {songs: data, user: user};
		});
			
	});
	return {spotifyPromises: spotifyPromises, jaredAccessToken: jaredAccessToken};
}
function updateTracks(spotifyData, jaredAccessToken){
	// this function updates tracks in the database, and sends tracks to spotify
	console.log('INSIDE UPDATE TRACKS');		
	var totalTracks = [];
	var trackUris = [];
	spotifyData.forEach((data) =>{
		var userSongs = data.songs;
		userSongs.body.items.forEach((item)=>{
			trackUris.push(item.uri);
			totalTracks.push({name: item.name, artists: item.artists, user: data.user.name});
		});
	});
	const playlist_id = '674PhRT9Knua4GdUkgzTel';
	console.log('calling spotify');
    spotifyApi.setAccessToken(jaredAccessToken);
	spotifyApi.replaceTracksInPlaylist(playlist_id, trackUris)
	.then((res)=> {
		console.log(res);
	});

    var lastUpdated = new Date();
	return Tracks.findOneAndUpdate({}, {tracks: totalTracks, lastUpdated: lastUpdated}, {upsert: true, new: true},
		function(err, tracks){
			if(err) console.log(err);
			else {
				return tracks;
			}
	});
}
function doEverything(){
	// gets users, refreshes all access tokens, saves tracks to the database and to spotify
	// returns updated tracks list

	// mongoose.connect(uri, {useNewUrlParser: true});
	// var db = mongoose.connection;
	//db.once('open', ()=> {
		console.log('inside do everything');
        return getUsers().then((tokensPromiseArray)=>{
			return Promise.all(tokensPromiseArray).then((tokensArray)=>{
				return Promise.all(updateTokens(tokensArray)).then((updatedUsersArray)=>{
					var spotifyDataObject = getTracksFromSpotify(updatedUsersArray);
					var jaredAccessToken = spotifyDataObject.jaredAccessToken;
					var spotifyPromises = spotifyDataObject.spotifyPromises;
					return Promise.all(spotifyPromises)	
					.then((spotifyData) =>{
						return updateTracks(spotifyData, jaredAccessToken);
					});	
				});
			});
		});
	//});
}	

module.exports = {
    doEverything
}
