var fs = require('fs'),
    util = require('util'),
    _ = require('lodash'),
    prettyJs = require('pretty-js'),
    urlSafeBase64 = require('urlsafe-base64');

// copy lodash methods to this library
_.assign(exports, _);
_.assign(exports, util);

exports.extendJS = function () {
   require(__dirname + '/extensions');
};

exports.getFuncName = function (fnc) {
   if (!fnc) { return null; }
   
   // function.name in ES6
   if (fnc.name) { return fnc.name; }
   
   var ret = fnc.toString();
   ret = ret.substr('function '.length);

   return ret.substr(0, ret.indexOf('('));
};

exports.existsSync = fs.existsSync || function (filePath){
   try {
      fs.statSync(filePath);
   } catch(err){
      if (err.code == 'ENOENT') { return false; }
   }
   
   return true;
};

// Apply delegate against an enumerable type
// delegate(key/index, val)
exports.forAll = function (enumerable, delegate) {
   if (!enumerable) { return; }
   // also treat as array if enumerable is not a function and has a value.length, eg strings
   if (isFunction(enumerable.map)) {
      enumerable.map(function (val, index, array) {
         delegate(index, val);
      });
   } else if (Array.isArray(enumerable)) {
      for (var i = 0; i < enumerable.length; i++) {
          delegate(i,enumerable[i]);
      }
   } else if (_.isObject(enumerable)) {
      _.forOwn(enumerable, function(val, key) {
         delegate(key, val);
      });
   } else {
      throw new Error ('Invalid Parameter: the first argument must be an enumerable type.');
   }
};

// Determine path is a file
exports.isFile = function (path) {
   var result = false;
   try {
      result = fs.lstatSync(path).isFile();
   } catch (err) {
   }
   
   return result;
};

// Determine if path is a directory
exports.isDir = function (path) {
   var result = false;
   try {
      result = fs.lstatSync(path).isDirectory();
   } catch (err) {
   }
   
   return result;
};

var prettyOpts = {
    indent: "   ",
    newline: "\n"
    //jslint: true
};

exports.pretty = function (obj, opts) {
   if (!obj) { return null; }
   var theseOpts = opts || prettyOpts;
   
   var blob = "";
   
   try {
      blob = _.isString(obj) ? obj : JSON.stringify(obj,null,3);
   } catch (err) {
      // circular reference, so use util::inspect
      blob = util.inspect(obj, { depth: 5 });
   }
   
   return prettyJs(blob, theseOpts);
};

// Convert 'data' to a base 64 encoded string (data may be a Buffer or it may be a string (if string it will be put into a buffer as utf8).
// Uses "Safe URL format so that it can be used in URLs without extra encoding. This is called
// modified Base64 for URL.
exports.base64Encode = function (input) {
   return urlSafeBase64.encode(!Buffer.isBuffer(input) ? new Buffer(input, 'utf8') : input);
};

function isFunction(fcn) {
  return (typeof fcn === 'function');
};
exports.isFunction = isFunction;
