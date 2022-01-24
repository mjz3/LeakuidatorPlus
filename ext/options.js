"use strict";

var extMode = "Relaxed";

init();

function init() {
    
    populateOptionsPage();
    initializeListeners();
}

function populateOptionsPage() {
    chrome.runtime.sendMessage({type: 'getMode'}, function(response) {
        populateMode(response.val);
    });
}

function populateMode(data) {
    if(data == undefined || !data) {
        // do nothig!
    } else {
        let e = document.getElementById('modeOption');
        extMode = data;
        if(data == 'Relaxed') {
            e.selectedIndex = 0;
        } else {
            e.selectedIndex = 1;
        }
    }
    
    if(extMode == "Relaxed") {
        chrome.runtime.sendMessage({type: "getExcludeSiteList"}, function(response) {
            populateExcludeList(response.val);
        });
        chrome.runtime.sendMessage({type: "getIgnoreSiteList"}, function(response) {
            populateIgnoreList(response.val);
        });
    } else {
        chrome.runtime.sendMessage({type: 'getExcludeOriginList'}, function(response) {
            populateExcludeList(response.val);
        });
        chrome.runtime.sendMessage({type: 'getIgnoreOriginList'}, function(response) {
            populateIgnoreList(response.val);
        });
    }
    
}
function populateExcludeList(data) {
    if(data == undefined || !data) {
        // do nothig!
    } else {
        let excludeSelect = document.getElementById('excludedMappingsBox');
        for(let r = 0; r < data.length; r++) {
            let opt = document.createElement("option");
            opt.value = r;
            opt.innerHTML = data[r][0] + " => " + data[r][1];
            excludeSelect.appendChild(opt);
        }
    }
}

function populateIgnoreList(data) {
    if(data == undefined || !data) {
        // do nothig!
    } else {
        let ignoreSelect = document.getElementById('ignoredMappingsBox');
        for(let r = 0; r < data.length; r++) {
            let opt = document.createElement("option");
            opt.value = r;
            opt.innerHTML = data[r][0] + " => " + data[r][1];
            ignoreSelect.appendChild(opt);
        }
    }
}

function initializeListeners() {
    modeListener();
    excludeAddListener();
    excludeRemoveListener();
    ignoreAddListener();
    ignoreRemoveListener();
}

function modeListener() {
    let btn = document.getElementById('saveModeButton');
    btn.addEventListener("click", function() {
        let e = document.getElementById('modeOption');
        extMode = e.options[e.selectedIndex].text;
        chrome.runtime.sendMessage({type: 'saveMode', mode: extMode}, null);
        let status = document.getElementById('status');
        status.textContent = 'mode saved.';
        setTimeout(function() {status.textContent = '';}, 750);
        location.reload(true);
    });
}

function excludeAddListener() {
    let btn = document.getElementById("addToExcludeMap");
    btn.addEventListener("click", function() {
        let originElement = document.getElementById("newExcludeSourceHost");
        let targetElement = document.getElementById("newExcludetargetHost");
        let originVal = originElement.value;
        let targetVal = targetElement.value;

        if(extMode == "Relaxed") {
            chrome.runtime.sendMessage({type: 'excludeSite', source: originVal, target: targetVal}, null);
        } else {
            chrome.runtime.sendMessage({type: 'excludeOrigin', source: originVal, target: targetVal}, null);
        }
        
        originElement.value="";
        targetElement.value="";

        let excludeSelect = document.getElementById('excludedMappingsBox');
        let opt = document.createElement("option");
        opt.value = excludeSelect.length;
        opt.innerHTML = originVal + " => " + targetVal;
        excludeSelect.appendChild(opt);
    });
}

function excludeRemoveListener() {
    let btn = document.getElementById("removeFromExcludeMap");
    btn.addEventListener("click", function() {
        let excludeSelect = document.getElementById("excludedMappingsBox");
        let remove = [];
        for(let i = 0; i < excludeSelect.length; i++) {
            if(excludeSelect.options[i].selected) {
                let opt = excludeSelect.options[i];
                //console.log("value before split: " + opt.text);
                let texts = opt.text.split(' => ');
                //console.log("splited values: " + texts[0] + " " + texts[1] + " " + texts[2]);
                let element = [texts[0], texts[1]];
                remove.push(element);
                excludeSelect.options[i] = null;
            }
        }
        if(!remove.length)
            return;
        
        for(let i = 0; i < remove.length; i++) {
            //console.log("request to remove: " + remove[i][0] + " to " + remove[i][1]);
            if(extMode == "Relaxed") {
                chrome.runtime.sendMessage({type: 'removeExcludeSite', source: remove[i][0], target: remove[i][1]}, null);
            } else {
                chrome.runtime.sendMessage({type: 'removeExcludeOrigin', source: remove[i][0], target: remove[i][1]}, null);
            }
        }
        //deosnt remove!
    });
}

function ignoreAddListener() {
    let btn = document.getElementById("addToIgnoreMap");
    btn.addEventListener("click", function() {
        let originElement = document.getElementById("newIgnoreSourceHost");
        let targetElement = document.getElementById("newIgnoretargetHost");
        let originVal = originElement.value;
        let targetVal = targetElement.value;

        if(extMode == "Relaxed") {
            chrome.runtime.sendMessage({type: 'ignoreSite', source: originVal, target: targetVal}, null);
        } else {
            chrome.runtime.sendMessage({type: 'ignoreOrigin', source: originVal, target: targetVal}, null);
        }
        
        originElement.value="";
        targetElement.value="";

        let ignoreSelect = document.getElementById('ignoredMappingsBox');
        let opt = document.createElement("option");
        opt.value = ignoreSelect.length;
        opt.innerHTML  = originVal + " => " + targetVal;
        ignoreSelect.appendChild(opt);
    });
}

function ignoreRemoveListener() {
    let btn = document.getElementById("removeFromIgnoreMap");
    btn.addEventListener("click", function() {
        let ignoreSelect = document.getElementById("ignoredMappingsBox");
        let remove = [];
        for(let i = 0; i < ignoreSelect.length; i++) {
            if(ignoreSelect.options[i].selected) {
                let opt = ignoreSelect.options[i];
                //console.log("value before split: " + opt.text);
                let texts = opt.text.split(' => ');
                //console.log("splited values: " + texts[0] + " " + texts[1] + " " + texts[2]);
                let element = [texts[0], texts[1]];
                remove.push(element);
                ignoreSelect.options[i] = null;
            }
        }
        if(!remove.length)
            return;
        
        for(let i = 0; i < remove.length; i++) {
            //console.log("request to remove: " + remove[i][0] + " to " + remove[i][1]);
            if(extMode == "Relaxed") {
                chrome.runtime.sendMessage({type: 'removeIgnoreSite', source: remove[i][0], target: remove[i][1]}, null);
            } else {
                chrome.runtime.sendMessage({type: 'removeIgnoreOrigin', source: remove[i][0], target: remove[i][1]}, null);
            }
        }
        //deosnt remove
    });
}
