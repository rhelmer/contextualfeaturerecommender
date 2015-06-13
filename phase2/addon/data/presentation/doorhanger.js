/*! This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";


self.port.on("updateEntry", function(entry, options){

  let message = entry.message;
  let title = entry.title;
  let primButtonLabel = entry.primaryButtonLabel;
  let secButtonLabel = entry.secondaryButtonLabel;
  let rationale = entry.rationale || "";
  let iconSrc = entry.icon;
  self.port.emit("log", iconSrc);

  document.getElementById("icon").src = iconSrc;
  document.getElementById("icon").onerror = function(){
    this.src = "images/firefox-highres.png";
  };
  document.getElementById("textbox").innerHTML = message;
  document.getElementById("header").innerHTML = title;
  document.getElementById("prim-button").innerHTML = primButtonLabel;
  document.getElementById("sec-button").innerHTML = secButtonLabel;
  if (!primButtonLabel)
    document.getElementById("prim-button").classList.add('disabled');
  if (!secButtonLabel)
    document.getElementById("sec-button").classList.add('disabled');
  document.querySelector("#rationalesection p").innerHTML = rationale;

  
  updatePanelSize();

  //setting the callback
  document.getElementById("sec-button").addEventListener("click", secButtonClick);
  document.getElementById("prim-button").addEventListener("click", primButtonClick);
  document.getElementById("close-button").addEventListener("click", closeButtonClick);


  document.body.addEventListener("mouseenter", function(e){
    self.port.emit("mouseenter");
  });
  document.body.addEventListener("mouseleave", function(e){
    self.port.emit("mouseleave");
  });

  
  document.getElementById("neg-feedback").addEventListener("click", openNegFeedback);

  let rsTimeout;

  document.getElementById("clickarea").addEventListener("mouseenter", function(e){
    if (document.getElementById("recommcontainer").classList.contains("invisible"))
      return;

    let rs = document.getElementById("rationalesection");
    if (rs.classList.contains('visible'))
      clearTimeout(rsTimeout);
    else
      expandRationale();
  });

  document.getElementById("feedback-form").addEventListener("change", function(e){
    submitFeedback();
  });

  document.body.addEventListener("mouseleave", function(e){
    if (document.getElementById("recommcontainer").classList.contains("invisible"))
      return;

    let rs = document.getElementById("rationalesection");
    if (rs.classList.contains('visible')){
      rsTimeout = setTimeout(collapseRationale, 500);
    }
  });

  document.getElementById("info-page").addEventListener("click", function(e){
    self.port.emit("infoPage");
  });


  window.addEventListener("keydown", function(e){
    if (e.key === "Escape")
      self.port.emit("hide", "escape");
  });

  self.port.emit("conntest", "load");
});


function capitalize(string){
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function secButtonClick(){
  self.port.emit("response", "secondaryButton");
  self.port.emit("hide", "response", true);
}

function primButtonClick(){
  self.port.emit("response", "primaryButton")
  self.port.emit("hide", "response", true);
}

function closeButtonClick(){
  self.port.emit("hide", "closeButtonClicked");
}

function changeBodySize(panelSize){
  document.body.style.width = (panelSize.width - 2).toString() + "px";
  document.body.style.height = (panelSize.height - 3).toString() + "px";
}

function updatePanelSize(width, height){
  self.port.emit("resize", {height: height || Number(getComputedStyle(document.body).height.slice(0,-2)),
    width: width || Number(getComputedStyle(document.body).width.slice(0,-2))});
}

function openNegFeedback(){  
  collapseRationale();
  document.getElementById("feedbackcontainer").classList.add("visible");
  document.getElementById("recommcontainer").classList.add("invisible");
  document.getElementById("top-left-links").classList.add("visible");
  document.getElementById("interpunct").classList.add("invisible");
  document.getElementById("info-page").classList.add("invisible");
  document.getElementById("neg-feedback").classList.add("active");
  document.getElementById("button-container").classList.add("feedback");
  document.getElementById("prim-button").classList.add("invisible");
  document.getElementById("sec-button").classList.add("feedback");
  document.getElementById("sec-button").innerHTML = "Learn more about Feature Recommender";
  document.getElementById("sec-button").classList.remove("disabled");
  document.getElementById("sec-button").removeEventListener("click", secButtonClick);
  document.getElementById("sec-button").addEventListener("click", function(e){
    self.port.emit("infoPage"); 
  });
}

function expandRationale(){
  document.getElementById("rationalesection").classList.add('visible');
  document.getElementById("triangle").classList.add('open');
  document.getElementById("rationalesection").style.opacity = 1;
  updatePanelSize();
}

function collapseRationale(){

  document.getElementById("rationalesection").addEventListener("transitionend", function hideRationale(e){
    document.getElementById("rationalesection").removeEventListener("transitionend", hideRationale);
    document.getElementById("rationalesection").classList.remove('visible');
    document.getElementById("triangle").classList.remove('open');
    updatePanelSize();
  });

  document.getElementById("rationalesection").style.opacity = 0;
}

function submitFeedback(){
  setTimeout(function(){
    document.getElementById("feedbackcontainer").classList.remove("visible");
    document.getElementById("thankscontainer").classList.add("visible");
    setTimeout(function(){
      self.port.emit("hide", "feedbacksubmission", true);
    }, 3000);
  }, 500);
}