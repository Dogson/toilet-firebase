const toilets = require('./toilets');
const functions = require('firebase-functions');
const admin = require('firebase-admin');


exports.getRating = function(app, ratingId) {
    return app.database().ref('ratings/' + ratingId).once('value')
        .then((snapshot) => {
            if (snapshot.val()) {
                return snapshot.val();
            }
        })
};

exports.createRating = function(app, rating) {
    delete rating.uid;
    let newRef = app.database().ref('ratings').push();
    let key = newRef.key;
    return newRef.set(rating)
        .then(() => {
            return key;
        });
};

exports.updateRating = function(app, rating) {
    let id = rating.uid;
    if (!rating.uid)
        return this.createRating(app, rating);
    delete rating.uid;
    return app.database().ref('ratings/' + id).set(rating)
        .then(() => {
            return id;
        });
};


exports.deleteRating = function(app, ratingId) {
    return app.database().ref('ratings/' + ratingId).remove();
};

exports.getUserRating = function(app, userRatingId) {
    let userRating;
    return app.database().ref('userRatings/' + userRatingId).once('value')
        .then((snapshot) => {
            if (snapshot.val()) {
                userRating = snapshot.val();
                return this.getRating(app, userRating.ratingId);
            }
        })
        .then((rating) => {
            userRating = {
                isAccessible: userRating.isAccessible,
                isMixed: userRating.isMixed,
                rating: rating,
                userId: userRating.userId,
            };
            return userRating;
        })
};

exports.createUserRating = function(app, userId, toiletId, userRating) {
    let uRating = userRating;
    return this.createRating(app, userRating.rating)
        .then((ratingId) => {
            let userRating = {
                isAccessible: uRating.isAccessible,
                isMixed: uRating.isMixed,
                ratingId: ratingId,
                userId: userId,
                toiletId: toiletId
            };
            return app.database().ref('userRatings').push().set(userRating);
        });

};

exports.updateUserRating = function(app, userId, toiletId, userRating) {
    return this.getUserRating(app, userRating.uid).then((ur) => {
        if (ur && ur.userId ===  userId) {
            userRating.rating.uid = userRating.rating.ratingId;
            return this.updateRating(app, userRating.rating)
                .then((ratingId) => {
                    let userRatingUpdated = {
                        isAccessible: userRating.isAccessible,
                        isMixed: userRating.isMixed,
                        ratingId: ratingId,
                        userId: userId,
                        toiletId: toiletId
                    };
                    return app.database().ref('userRatings/' + userRating.uid).set(userRatingUpdated);
                });
        }
    });
};

exports.deleteUserRating = function(app, userId, userRatingId) {
    return app.database().ref('userRatings/' + userRatingId).once('value')
        .then((snapshot) => {
            const userRating = snapshot.val();
            if (userRating && userRating.userId === userId) {
                return this.deleteRating(app, userRating.ratingId)
                    .then(() => {
                        return app.database().ref('userRatings/' + userRatingId).remove();
                    });
            }
            else {
                return Promise.reject({code: "incorrect_user"});
            }
        })
};


exports.createUserReview = functions.https.onCall((data, context) => {
    const appOptions = JSON.parse(process.env.FIREBASE_CONFIG);
    appOptions.databaseAuthVariableOverride = context.auth;
    const app = admin.initializeApp(appOptions, 'kooy');
    const deleteApp = () => app.delete().catch(() => null);

    const toiletId  = data.toiletId;
    const userRating = data.userRating;
    const userId = context.auth.uid;
    return toilets.createOrUpdateToilet(app, {uid: toiletId})
        .then(() => {
            return app.database().ref('userRatings').orderByChild('userId').equalTo(context.auth.uid).once('value')
                .then((snapshot) => {
                    let userRatings = snapshot.val();
                    if (!userRatings)
                        return this.createUserRating(app, userId, toiletId, userRating);
                    let ur = Object.keys(userRatings).map((key) => {
                        let u = userRatings[key];
                        u.uid = key;
                        return u;
                    }).find((uRating) => {
                        return uRating.toiletId === toiletId;
                    });
                    if (!ur) {
                        return this.createUserRating(app, userId, toiletId, userRating);
                    }
                    return this.updateUserRating(app, userId, toiletId, userRating);
                });
        })
        .then(() => {
            return toilets.updateToiletRating(app, toiletId, userId)
        })
        .then(() => {
            return deleteApp();
        });
});

exports.updateUserReview = functions.https.onCall((data, context) => {
    const appOptions = JSON.parse(process.env.FIREBASE_CONFIG);
    appOptions.databaseAuthVariableOverride = context.auth;
    const app = admin.initializeApp(appOptions, 'app');
    const deleteApp = () => app.delete().catch(() => null);

    const toiletId  = data.toiletId;
    const userRating = data.userRating;
    const userId = context.auth.uid;
    return toilets.createOrUpdateToilet(app, {uid: toiletId})
        .then(() => {
            return this.updateUserRating(app, userId, toiletId, userRating);
        })
        .then(() => {
            return toilets.updateToiletRating(app, toiletId, userId);
        })
        .then(() => {
            return deleteApp();
        })
});

exports.deleteUserReview = functions.https.onCall((data, context) => {
    const appOptions = JSON.parse(process.env.FIREBASE_CONFIG);
    appOptions.databaseAuthVariableOverride = context.auth;
    const app = admin.initializeApp(appOptions, 'app');
    const deleteApp = () => app.delete().catch(() => null);

    const toiletId  = data.toiletId;
    const userRatingId = data.userRatingId;
    const userId = context.auth.uid;
    return this.deleteUserRating(app, userId, userRatingId)
        .then(() => {
            return toilets.updateToiletRating(app, toiletId, userId)
        })
        .then(() => {
            return deleteApp();
        })
});