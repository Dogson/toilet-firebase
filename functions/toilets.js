const ratings = require('./ratings');
const functions = require('firebase-functions');
const admin = require('firebase-admin');

exports.getToilet = functions.https.onCall((data, context) => {
    const appOptions = JSON.parse(process.env.FIREBASE_CONFIG);
    appOptions.databaseAuthVariableOverride = context.auth;
    const app = admin.initializeApp(appOptions, 'app');
    const deleteApp = () => app.delete().catch(() => null);

    const toiletId = data.toiletId;
    const userId = context.auth.uid;

    return this.getToiletCallable(app, toiletId, userId)
        .then((toilet) => {
            return deleteApp().then(() => {
                return toilet;
            });
        })
        .catch((error) => {
            return deleteApp().then(() => {
                return Promise.reject(error);
            });
        });
});

exports.getToiletCallable = function (app, toiletId, userId) {
    let toilet;
    return app.database().ref('toilets/' + toiletId).once('value')
        .then((snapshot) => {
            toilet = snapshot.val();
            if (!toilet) {
                return toilet;
            }
            toilet.uid = toiletId;
            if (!toilet.ratingId) {
                return toilet;
            }
            return app.database().ref('ratings/' + toilet.ratingId).once('value')
                .then((snapshot2) => {
                    toilet.rating = snapshot2.val();
                    return app.database().ref('userRatings').orderByChild('userId').equalTo(userId).once('value')
                        .then((snapshot3) => {
                            let userRatings = snapshot3.val();
                            if (!userRatings)
                                return toilet;
                            let userRating = Object.keys(userRatings).map((key) => {
                                let r = userRatings[key];
                                r.uid = key;
                                return r;
                            }).find((userRating) => {
                                return userRating.toiletId === toiletId;
                            });
                            if (!userRating) {
                                return toilet;
                            }
                            toilet.userRating = userRating;
                            return app.database().ref('ratings/' + userRating.ratingId).once('value')
                                .then((snapshot4) => {
                                    toilet.userRating.rating = snapshot4.val();
                                    return toilet;
                                })

                        })
                });
        })
};

exports.createToilet = function (app, toilet) {
    let id = toilet.uid;
    delete toilet.uid;
    toilet.ratingCount = 0;
    return app.database().ref('toilets/' + id).set(toilet)
        .then(() => {
            return id;
        });
};

exports.createOrUpdateToilet = function (app, toilet) {
    let t = toilet;
    return app.database().ref('toilets/' + toilet.uid).once('value')
        .then((snapshot) => {
            let toilet = snapshot.val();
            if (toilet) {
                let id = t.uid;
                delete t.uid;
                return app.database().ref('toilets/' + id).update(t);
            }
            else {
                return this.createToilet(app, t);
            }
        });
};


exports.updateToiletRating = function (app, toiletId, userId) {
    let userRatings;
    let isAccessibleCount = 0;
    let isMixedCount = 0;
    let ratingCount = 0;
    let globalRating = {
        global: 0,
        cleanliness: 0,
        functionality: 0,
        decoration: 0,
        value: 0
    };
    let toilet;
    return app.database().ref('userRatings').orderByChild('toiletId').equalTo(toiletId).once('value')
        .then((snapshot) => {
            let ratingArrays;
            userRatings = snapshot.val();
            if (userRatings) {
                ratingArrays = Object.keys(userRatings).map((key) => {
                    let u = userRatings[key];
                    u.uid = key;
                    return u;
                });
            }
            else {
                ratingArrays = [];
            }

            return Promise.all(ratingArrays.map((rating) => {
                return ratings.getRating(app, rating.ratingId)
                    .then((result) => {
                        rating.rating = result;
                        return rating;
                    });
            }));
        })
        .then((ratingArray) => {
            ratingArray.forEach((userRating) => {
                let rating = userRating.rating;
                if (rating && rating.global) {
                    ratingCount++;

                    globalRating = {
                        global: (globalRating.global * (ratingCount - 1) + rating.global) / ratingCount,
                        cleanliness: (globalRating.cleanliness * (ratingCount - 1) + rating.cleanliness) / ratingCount,
                        functionality: (globalRating.functionality * (ratingCount - 1) + rating.functionality) / ratingCount,
                        decoration: (globalRating.decoration * (ratingCount - 1) + rating.decoration) / ratingCount,
                        value: (globalRating.value * (ratingCount - 1) + rating.value) / ratingCount,
                    }
                }

                if (userRating.isMixed != null) {
                    isMixedCount = userRating.isMixed ? isMixedCount + 1 : isMixedCount - 1;
                }
                if (userRating.isAccessible != null) {
                    isAccessibleCount = userRating.isAccessible ? isAccessibleCount + 1 : isAccessibleCount - 1;
                }
            });
            return this.getToiletCallable(app, toiletId, userId);
        })
        .then((result) => {
            toilet = result;
            globalRating.uid = toilet.ratingId;
            if (ratingCount > 0) {
                return ratings.updateRating(app, globalRating)
                    .then((ratingId) => {
                        let updatedToilet = {
                            uid: toilet.uid,
                            isAccessible: ratingCount > 0 && isAccessibleCount !== 0 ? isAccessibleCount > 0 : null,
                            isMixed: ratingCount > 0 && isMixedCount !== 0 ? isMixedCount > 0 : null,
                            ratingId: ratingId,
                            ratingCount: ratingCount
                        };
                        return this.createOrUpdateToilet(app, updatedToilet);
                    })
            }
            else {
                return ratings.deleteRating(app, globalRating.uid)
                    .then(() => {
                        let updatedToilet = {
                            uid: toilet.uid,
                            isAccessible: ratingCount > 0 && isAccessibleCount !== 0 ? isAccessibleCount > 0 : null,
                            isMixed: ratingCount > 0 && isMixedCount !== 0 ? isMixedCount > 0 : null,
                            ratingCount: 0
                        };
                        return this.createOrUpdateToilet(app, updatedToilet);
                    })
            }
        })

};

exports.getToiletReviews = functions.https.onCall((data, context) => {
    const appOptions = JSON.parse(process.env.FIREBASE_CONFIG);
    appOptions.databaseAuthVariableOverride = context.auth;
    const app = admin.initializeApp(appOptions, 'app');
    const deleteApp = () => app.delete().catch(() => null);

    const toiletId = data.toiletId;
    return app.database().ref('userRatings').orderByChild('toiletId').equalTo(toiletId).once('value')
        .then((snapshot) => {
            let ratingArrays;
            let userRatings = snapshot.val();
            if (userRatings) {
                ratingArrays = Object.keys(userRatings).map((key) => {
                    let u = userRatings[key];
                    u.uid = key;
                    return u;
                });
            }
            else {
                ratingArrays = [];
            }

            return Promise.all(ratingArrays.map((rating) => {
                return ratings.getRating(app, rating.ratingId)
                    .then((result) => {
                        rating.rating = result;
                        return rating;
                    });
            }));
        })
        .then((ratingArrays) => {
            return Promise.all(ratingArrays.map((rating) => {
                return app.database().ref('users/' + rating.userId).once('value')
                    .then((snapshot) => {
                        if (snapshot.val()) {
                            rating.user = snapshot.val();
                            return rating;
                        }
                    })
            }));
        })
        .then((ratingArrays) => {
            return deleteApp()
                .then(() => {
                    return ratingArrays;
                })
        })
        .catch((error) => {
            return deleteApp().then(() => {
                return Promise.reject(error);
            });
        });


});