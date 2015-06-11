
"use strict";

const {Recommendation} = require("./recommendation");
const controller = require("./controller");
const {data} = require("sdk/self");
const {WindowTracker} = require("sdk/deprecated/window-utils");
const logger = require("./logger");
const self = require("./self");

const recommFileAddress = "recommendations.json";

require("presentation/splitpage").init();  //TODO: move somewhere more meaningful
require("presentation/doorhanger").init();
require("experiment").init();
require("timer").init();
require("logger").init();
require("debug").init();


exports.main = function(options, callbacks){
  console.log("Hello World! I am alive :)");

  if (!self.isInitialized)
    firstRun();

  logger.logLoad(options.loadReason);

  controller.init();
}

function firstRun(){
  let recommendations = JSON.parse(data.load(recommFileAddress)).map(function(recData){
    return Recommendation(recData);
  });

  controller.recommendations.add.apply(controller.recommendations, recommendations);

  logger.logFirstRun();
  self.setInitialized();
}

function periodicLog(lapsedTime){
  if (lapsedTime % 20 != 0) return;
  logger.logPeriodicInfo(self.periodicInfo);
}





