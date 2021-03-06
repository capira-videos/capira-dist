'use strict';
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var config = require('./config');
var Lesson = require('./models/lesson');
var compression = require('compression');

/* passport lti */
var passport = require('passport');
var lti = require('./app-auth-lti')(passport);
passport.use(lti);

var mongoose = require('mongoose');
mongoose.connect(config.mongoDB);

process.on('SIGINT', function() {
    mongoose.connection.close(function() {
        console.log('Mongoose disconnected on app termination');
        process.exit(0);
    });
});

var express = require('express');
var app = express();
var twoDays = config.debug ? 0 : 2 * 86400000;

app.enable('trust proxy');

app.use(compression());

app.use(cookieParser());
app.use(express.static(config.webRoot, { maxAge: twoDays }));
app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(bodyParser.json({
    limit: '5mb'
}));
app.use(session({
    secret: config.cookieSecret,
    proxy: true
}));
app.use(passport.initialize());
app.use(passport.session());


// Create our Express router 
var router = express.Router();
var Lesson = Lesson(router);

app.post('/', function(req, res, next) {
    passport.authenticate('lti', function(err, user, requestedResource) {
        if (err) {
            return next(err);
        }
        if (!user) {
            return res.send('error: no user');
        }

        req.logIn(user, function(err) {
            if (err) {
                return next(err);
            }
            //console.log('user', user);
            //console.log('requestedResource', requestedResource);

            // Find requested resource in capira-db

            var query = requestedResource.lessonId ? {
                _id: requestedResource.lessonId
            } : {
                'resource.resourceId': requestedResource.resourceId,
                'resource.instanceId': requestedResource.instanceId
            }

            Lesson.find(query, {
                _id: 1,
                notInitialized: 1
            }, function(err, results) {
                //if lesson not exists yet
                if (results && results.length === 0) {
                    //check if user is admin
                    if (!user.isAdmin) {
                        return res.send('unauthorized request');
                    }
                    // create new lesson in capira-db 
                    var newLesson = new Lesson();
                    newLesson.resource = requestedResource;
                    newLesson.title = requestedResource.title;
                    newLesson.notInitialized = true;
                    newLesson.save(function(err, lesson) {
                        // redirect user to /player/create/:lessonId
                        return res.redirect(config.createEndpoint + lesson._id);
                    });
                } else {
                    var lesson = results[0];
                    if (lesson.notInitialized) {
                        if (!user.isAdmin) {
                            return res.send('unauthorized request');
                        }
                        // redirect user to the editor to create a unit
                        return res.redirect(config.createEndpoint + lesson._id);
                    }
                    // redirect user to the requested lesson
                    return res.redirect(config.playerEndpoint + lesson._id);
                }
            });
        });
    })(req, res, next);
});







app.lti = lti;


app.use('/api', router);
module.exports = app;
