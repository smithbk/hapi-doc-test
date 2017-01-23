/*
 * hapi-doc-test - HTTP API documentation generator and test tool
 * Each API has two sections: request and response.
 * 1) The request section describes the input to the API in terms of which
 *    variables are required to run the API; in other words, the each API
 *    may consume some set of variables.
 * 2) The response section describes the output of the API in terms of the
 *    variables that are produced.
 * The variables consumed and produced by the APIs are used to arrange the
 * APIs in a tree structure, which defines the order in which the APIs are to
 * be run.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var request = require('request');
var url = require('url');
var async = require('async');
var moduleClone = require('clone');
var lodash = require('lodash');
var util = require('util');
var common = require(__dirname+'/common');
var tv4 = require('tv4');
var glob = require('glob');

var log;
var APP_JSON = 'application/json';
var FORMAT_IGNORE = 'format_ignore';
var SCHEMA_REFS = false;

// Custom validator function to ignore
tv4.addFormat(FORMAT_IGNORE, function(data,schema) { return null; });

common.extendJS();

// The main HAPI tester object
function Hapi(vars) {
   this.setVars(vars);
   this.virtualHosts = [];
   this.mapis = [];
   this.apis = [];
   this.rootApis = [];
   this.referencedApis = [];
   this.errors = [];
   this.inDir = this.outDir = process.cwd();
   this.serialQueues = {};
}

//Set the log level
Hapi.prototype.setVars = function(vars) {
   this.vars = vars || {};
   if (log.isDebugEnabled()) log.debug("Hapi.setVars to %j",vars);
};

// Get the current log level
Hapi.prototype.getLogLevel = function() {
   return log.getLevel();
};

// Set the log level
Hapi.prototype.setLogLevel = function(level) {
   log.setLevel(level);
};


// Get the input directory
Hapi.prototype.getInputDir = function() {
   return this.inDir;
};

// Set the input directory
Hapi.prototype.setInputDir = function(dir) {
   this.inDir = dir;
};

// Get the output directory
Hapi.prototype.getOutputDir = function() {
   return this.outDir;
};

// Set the output directory
Hapi.prototype.setOutputDir = function(dir) {
   this.outDir = dir;
};

// Load HAPIs from a directory
Hapi.prototype.loadFromDir = function(dir) {
   var self = this;
   if (dir) self.setInputDir(dir);
   var loader = new HapiLoader();
   loader.loadFromDir(self.getInputDir());
   self.errors = loader.getErrors();
   if (self.errors.length === 0) {
      this.loadInfo(loader.getInfo(),null,normalizeVars(self.vars));
   }
};

Hapi.prototype.loadInfo = function(info,vhost,vars) {
   var self = this;
   if (info.variables) {
      vars = merge(vars,info.variables);
      for (var key in info.variables) {
         if (!self.vars.hasOwnProperty(key) && info.variables[key].hasOwnProperty('value')) {
            self.vars[key] = info.variables[key].value;
         }
      }
   }
   if (info.virtual_host) {
      if (vhost) throw Error("multiple levels of virtual hosts are not permitted");
      vhost = new VirtualHost(self,info.virtual_host,vars);
      self.virtualHosts.push(vhost);
      if (log.isDebugEnabled()) log.debug("loaded virtual host %s",vhost.getName());
   }
   if (info.elements) {
      for (var i = 0; i < info.elements.length; i++) {
         var ele = info.elements[i];
         var type = ele.type;
         var name = ele.name;
         var val = ele.value;
         switch(type) {
         case 'api':
            try {
               if (!vhost) throw Error(util.format("no virtual host for API %s",name));
               val.name = name;
               val.vars = vars;
               val.vhost = vhost;
               var mra = new MultiResponseApi(self,val);
               self.mapis.push(mra);
               vhost.mapis.push(mra);
            } catch (err) {
               var apiErr = log.isTraceEnabled() ? err.stack : err;
               self.errors.push(util.format("%s: %s",name,apiErr));
            }
            break;
         case 'elements':
            self.loadInfo(val,vhost,vars);
            break;
         default:
            throw Error("invalid type: "+type);
         }
      }
   }
};

Hapi.prototype.addMapi = function(info,vhost,vars) {
   var self = this;
   if (info.variables) {
      vars = merge(vars,info.variables);
      for (var key in info.variables) {
         if (!self.vars.hasOwnProperty(key) && info.variables[key].hasOwnProperty('value')) {
            self.vars[key] = info.variables[key].value;
         }
      }
   }
   if (info.virtual_host) {
      if (vhost) throw Error("multiple levels of virtual hosts are not permitted");
      vhost = new VirtualHost(self,info.virtual_host,vars);
      self.virtualHosts.push(vhost);
      if (log.isDebugEnabled()) log.debug("loaded virtual host %s",vhost.getName());
   }
   if (info.elements) {
      for (var i = 0; i < info.elements.length; i++) {
         var ele = info.elements[i];
         var type = ele.type;
         var name = ele.name;
         var val = ele.value;
         switch(type) {
         case 'api':
            try {
               if (!vhost) throw Error(util.format("no virtual host for API %s",name));
               val.name = name;
               val.vars = vars;
               val.vhost = vhost;
               var mra = new MultiResponseApi(self,val);
               self.mapis.push(mra);
               vhost.mapis.push(mra);
            } catch (err) {
               var apiErr = log.isTraceEnabled() ? err.stack : err;
               self.errors.push(util.format("%s: %s",name,apiErr));
            }
            break;
         case 'elements':
            self.loadInfo(val,vhost,vars);
            break;
         default:
            throw Error("invalid type: "+type);
         }
      }
   }
};

// Generate swagger documentation for APIs
Hapi.prototype.gendoc = function() {
   var self = this;
   var result = 0;
   if (log.isInfoEnabled()) log.info("generating doc ...");
   for (var i = 0; i < self.virtualHosts.length; i++) {
      var vhost = self.virtualHosts[i];
      try {
         var doc = vhost.gendoc();
         var file = self.outDir + "/swagger-" + vhost.getName() + ".json";
         fs.writeFileSync(file,JSON.stringify(doc,null,3));
         if (log.isInfoEnabled()) log.info("created %s",file);
      } catch (err) {
         var apiErr = log.isTraceEnabled() ? err.stack : err;
         self.errors.push(util.format("failure generating %s virtual host documentation: %s",vhost.getName(),apiErr));
         result = 2;
      }
   }
   if (self.errors.length > 0) {
      self.logErrors("Documentation Errors");
      result = 3;
   }
   return result;
};

// Compile the HAPIs associated with 'names' which can be an individual test name or group name
// Compilation involves building a test tree based on the dependency graph associated with:
// 1) what a HAPI consumes (i.e. the variables that it takes as input) and
// 2) what a HAPI produces (i.e. the variables that it sets as output).
Hapi.prototype.compile = function(testNames) {
   if (log.isDebugEnabled()) log.debug("compiling %s",testNames?testNames:"all tests");
   var self = this;
   var i,api;
   var apisToInsert = [];
   for (i = 0; i < self.mapis.length; i++) {
      var mapi = self.mapis[i];
      var match = mapi.matches(testNames);
      var apis = mapi.getApis();
      for (var j = 0; j < apis.length; j++) {
         api = apis[j];
         self.apis.push(api);
         for (var k = 0; !match && testNames && k < testNames.length; k++) {
            match = api.name.startsWith(testNames[k]);
         }
         if (match) apisToInsert.push(api);
      }
   }

   // Insert all of the HAPI's which match the name of the test (or all if null) into a tree
   // rooted at 'root'
   var root = new Node(this,null);
   for (i = 0; i < apisToInsert.length; i++) {
      api = apisToInsert[i];
      try {
         root.insertApi(api);
      } catch (err) {
         var apiErr = log.isTraceEnabled() ? err.stack : err;
         self.errors.push(util.format("%s: %s",api.name,apiErr));
      }
   }
   if (log.isTraceEnabled()) {
      log.trace("TEST TREE:");
      root.dump();
   }
   self.logErrors("COMPILATION ERRORS");
   return root;
};

// Run the HAPIs which match 'testNames', or all if 'testNames' is undefined
Hapi.prototype.run = function(testNames) {
   var self = this;
   try {
      var root = self.compile(testNames);
      if (!root || self.errors.length > 0) return;
      log.info("\nBEGIN TESTS (%s)",Date.format("dddd, mmmm dS, yyyy, h:MM:ss TT"));
      log.addTimeStamp = true;
      self.cookieJar = request.jar();
      var ctx = new RunContext(self.vars,root,0,1);
      ctx.run();
   } catch (err) {
      var apiErr = log.isTraceEnabled() ? err.stack : err;
      log.error(apiErr);
   }
   self.logErrors("Runtime Errors");
};

Hapi.prototype.findApi = function(name,where) {
   var self = this;
   for (var i = 0; i < self.apis.length; i++) {
      var api = self.apis[i];
      if (api.name === name) {
         log.debug("findAPI: %s (referenced in %s) was found",name,where);
         return api;
      }
   }
   var msg = util.format("findAPI: '%s' (referenced in %s) was NOT found",name,where);
   log.error(msg);
   throw new Error(msg);
};

// Determine if an API can be inserted by itself in the tree
// APIs that are referenced by other APIs are not insertable
Hapi.prototype.isInsertableApi = function(api) {
   var refs = this.referencedApis;
   var name = api.name;
   for (var i = 0; i < refs.length; i++) {
      if (name.startsWith(refs[i])) return false;
   }
   return true;
};

Hapi.prototype.getTimeout = function() {
   return this.timeout;
};

Hapi.prototype.setTimeout = function(timeout) {
   this.timeout = timeout;
};

Hapi.prototype.getApiProducers = function(varName) {
   var self = this;
   var apis = [];
   for (var i = 0; i < self.apis.length; i++) {
      var api = self.apis[i];
      if (api.produces.includes(varName)) {
         apis.addUniq(api);
      }
   }
   return apis;
};

Hapi.prototype.getPredefinedVars = function() {
   return Object.keys(this.vars);
};

Hapi.prototype.predefinesVar = function(varName) {
   return this.vars.hasOwnProperty(varName);
};

Hapi.prototype.logErrors = function(prefix) {
   var self = this;
   var errors = self.getErrors();
   if (errors.length > 0) {
      console.log("%s: %s",prefix,pretty(errors));
   }
};

Hapi.prototype.getErrors = function() {
   return this.errors;
};

function VirtualHost(hapi,info,vars) {
   this.hapi = hapi;
   this.info = info;
   this.vars = vars;
   this.mapis = [];
}

VirtualHost.prototype.getName = function() {
   return this.info.name || this.getHostVariable();
};

VirtualHost.prototype.getHostVariable = function() {
   return this.info.host_variable;
};

VirtualHost.prototype.gendoc = function() {
   var self = this;
   var errors = self.hapi.errors;
   if (log.isDebugEnabled()) log.debug("generating doc for vhost %s ...",self.getName());
   var doc = {};
   var swagger = self.info.swagger;
   if (!swagger) throw Error(util.format("no swagger info found for virtual host %s",self.info.name));
   for (var key in swagger) {
      doc[key] = swagger[key];
   }
   doc.paths = {};
   if (SCHEMA_REFS) {
      doc.definitions = {};
   }
   var state = {};
   for (var i = 0; i < self.mapis.length; i++) {
      var mapi = self.mapis[i];
      try {
         if (!mapi.private) mapi.addDoc(doc,state);
      } catch(err) {
         var errStr = log.isTraceEnabled() ? err.stack : err.toString();
         errStr = util.format("Failure in %s: %s",mapi.name,errStr);
         errors.push(errStr);
      }
   }
   if (errors.length > 0) {
      if (log.isInfoEnabled()) log.info("ERRORS generating swagger doc for %s: %s",self.getName(),pretty(errors));
   }
   return doc;
};

/**
 * There are two flavors of Api objects:
 * 1) MultiResponseApi - This is created initially from input and is all that is needed to generate documentation
 *    as it is most resembles the swagger structure.  The MultiResponseApi.gendoc function operates on this type of Api object.
 * 2) Api - This has a single response code and is used for compile and run of tests.  Calling MultiResponseApi.getApis returns
 *    and array of Api objects, one for each of the responses in MultiResponseApi.  The Api object is required for compile and run
 *    of tests.
 */
function MultiResponseApi(hapi, info) {
   var self = this;
   self.hapi = hapi;
   self.name = info.name;
   self.private = info.private;
   self.vars = info.vars;
   self.varValues = getVarValues(info.vars);
   self.vhost = info.vhost;
   if (!info.request) throw Error(util.format("no 'request' field found in %s",pretty(info)));
   if (!info.request.path) throw Error("no 'request.path' field found");
   if (!info.responses) throw Error("no 'responses' field found");
   if (!info.tags) throw Error("no 'tags' field found");
   self.description = info.description;
   self.tags = info.tags;
   self.request = info.request;
   self.request.method = self.request.method || 'GET';
   self.responses = info.responses;
   self.groups = info.groups || [];
   self.groups.push(self.name);
   self.onBeforeRun = info.onBeforeRun;
   self.onAfterRun = info.onAfterRun;
   self.before = info.before;
   self.afterApi = info.afterApi;
   self.afterAll = info.afterAll;
   self.consumes = info.consumes;
   self.produces = info.produces;
}

MultiResponseApi.prototype.getVirtualHost = function() {
   return this.vhost;
};

MultiResponseApi.prototype.getUrl = function() {
   return url.parse("http://host"+this.request.path);
};

// Determine if this Api matches any of the Api names or group names
// If 'names' is undefined, always match.
MultiResponseApi.prototype.matches = function(names) {
   var self = this;
   if (!names) return true;
   var groups = self.groups;
   for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      for (var j = 0; j < names.length; j++) {
         var name = names[j];
         if (group.startsWith(name)) {
            if (log.isDebugEnabled()) log.debug("match: %s, group %s matches %s",self.name,group,name);
            return true;
         }
      }
   }
   if (log.isDebugEnabled()) log.debug("no match: %s, groups=%j, names=%j",self.name,groups,names);
   return false;
};

MultiResponseApi.prototype.addDoc = function(doc,state) {
   var self = this;
   var defs = doc.definitions;
   var url = self.getUrl();
   var path = url.pathname;
   path = normalizePathForDoc(path);
   doc = doc.paths;
   if (!doc[path]) doc[path] = {};
   doc = doc[path];
   if (!state[path]) state[path] = {};
   state = state[path];
   var method = self.request.method;
   method = method.toLowerCase();
   if (doc[method]) {
      var name1 = state[method].name;
      var name2 = self.name;
      throw Error(util.format("multiple definitions for method %s of %s; %s and %s",method,url.path,name1,name2));
   }
   doc = doc[method] = {};
   state[method] = self;
   doc.tags = self.tags;
   doc.description = self.description;
   doc.parameters = self.getParameters(defs);
   if (!doc.responses) doc.responses = {};
   if (doc.responses[self.status]) throw Error("multiple APIs defined for "+self.name);
   doc = doc.responses;
   for (var scode in self.responses) {
      var response = self.responses[scode];
      doc[scode] = { description: response.description };
      doc[scode].schema = getSchemaRef(getBodySchema(response),defs);
   }
};


/*
 * Get parameters for an API used for doc generation
 */
MultiResponseApi.prototype.getParameters = function(defs) {
   var self = this;
   var req = self.request;
   var parms = [];
   var path = req.path.split('?');
   // Get variables from the URL's path
   getVarNames(path[0]).forEach(function(name) {
      parms.push(self.getDocParm(name,name,'path',true));
   });
   // Get variables from the URL's query parameters
   if (path.length > 0) {
      getVarNames(path[1]).forEach(function(name) {
         parms.push(self.getDocParm(name,name,'query',false));
      });
   }
   // Get variables from request headers
   var hdrs = req.headers;
   forAll(hdrs,function(hdrName,hdrVal) {
      getVarNames(hdrVal).forEach(function(varName) {
         parms.push(self.getDocParm(hdrName,varName,'header',true));
      });
   });
   // The request module's auth entry refers to the "Authorization" header
   getVarNames(req.auth).forEach(function(name) {
      parms.push(self.getDocParm('Authorization',name,'header',true));
   });
   // Add body parameter
   var bodySchema = getSchemaRef(getBodySchema(req,self.vars),defs);
   if (bodySchema) {
      parms.push({
         name: 'body',
         in: 'body',
         description: 'The request body',
         required: true,
         schema: bodySchema
      });
   }
   return parms;
};

MultiResponseApi.prototype.getDocParm = function(parmName,varName,type,required) {
   var ref = this.vars[varName];
   if (!ref) {
      throw Error(util.format("undefined variable '%s' is referenced in %s",varName,this.name));
   }
   if (!ref.description) {
      throw Error(util.format("variable '%s' referenced in %s does not have a description",varName,this.name));
   }
   return {
      name: parmName,
      in: type,
      description: ref.description,
      required: required,
      type: ref.type || "string"
   };
};

/*
 * Create API objects from this object based on:
 * 1) Number of responses
 * 2) Number of 'test' elements (if any) in each response
 */
MultiResponseApi.prototype.getApis = function() {
   var self = this;
   var test;
   var apis = [];
   for (var scode in self.responses) {
      var req = self.request;
      var res = self.responses[scode];
      var name = self.name + '-' + scode;
      // There is typically a single response w/o a 'tests' for the successful response case.
      // All other responses will typically have a 'tests' section defining replacement variable
      // values used to generate an error.
      var testList = [];
      var tests = res.tests;
      if (tests) {
         if (!isArray(tests)) tests = [tests];
         for (var i = 0; i < tests.length; i++) {
            test = tests[i];
            test.name = test.name || name;
            test.request = getTestReq(test.request,test.vars,req);
            test.onBeforeRun = self.onBeforeRun;
            test.onAfterRun = self.onAfterRun;
            test.before = test.before || self.before;
            test.afterApi = test.afterApi || self.afterApi;
            test.afterAll = test.afterAll || self.afterAll;
            test.consumes = (self.consumes || []).dup();
           // test.produces = (self.produces || []).dup();
            testList.push(test);
         }
      }
      if (testList.length === 0) {
         var tmpReq = getTestReq(res.request,res.vars,req);
         testList.push({name:name,request:tmpReq,response:res});
      }
      // For each of these requests, get all possible compile time values for the variables
      // and then generate a request for each combination of these values.
      // For example, if the "$authHdr" and "$grantType" variables are both used
      // where "$authHdr" can be "$basicAuthHdr" or "$tokenAuthHdr" and "$grantType" can be
      // one of "password" or "client_credentials", the total number of combinations is 4
      for (var j = 0; j < testList.length; j++) {
         test = testList[j];
         test.onBeforeRun = test.onBeforeRun || self.onBeforeRun;
         test.onAfterRun = test.onAfterRun || self.onAfterRun;
         self.setHook(test,'before');
         self.setHook(test,'afterApi');
         self.setHook(test,'afterAll');
         test.consumes = test.consumes || (self.consumes || []).dup();
         test.produces = test.produces || (self.produces || []).dup();
         var requestBodyVars = getVarNames(test.request.body);
         var combinations = getVarCombinations(self.varValues,getVarNames(test.request));
         for (var k = 0; k < combinations.length; k++) {
            var req2 = getObjectWithVarsReplaced(test.request,combinations[k]);
            var name2 = k ? test.name + '-' + k : test.name;
            apis.push(new Api(self,name2,req2,scode,test,requestBodyVars));
         }
      }
   }
   if (log.isDebugEnabled()) log.debug("getApis name=%s",self.name);
   return apis;
};

MultiResponseApi.prototype.setHook = function(test,hook) {
   if (!test[hook]) {
      if (test.response && test.response[hook]) test[hook] = test.response[hook];
      else test[hook] = this[hook];
   }
};

MultiResponseApi.prototype.getPredefinedVars = function() {
   var self = this;
   var vars = self.hapi.getPredefinedVars();
   for (var key in this.vars) {
      if (this.vars[key].hasOwnProperty('value')) {
         vars.push(key);
      }
   }
   return vars;
};

MultiResponseApi.prototype.predefinesVar = function(varName) {
   var val = this.vars[varName];
   return val && (val.hasOwnProperty('value') || this.hapi.predefinesVar(varName));
};

function Api(mapi,name,req,scode,test,requestBodyVars) {
   var self = this;
   self.mapi = mapi;
   self.hapi = mapi.hapi;
   self.vars = mapi.vars;
   self.requestBodyVars = requestBodyVars;
   self.vhost = mapi.vhost;
   name = common.trim(name, '/ ');
   if (!name.startsWith(self.vhost.getName()) && !name.contains('/')) {
      name = self.vhost.getName() + '/' + name;
   }
   self.name = name;
   self.request = clone(req);
   self.request.url = '$' + mapi.getVirtualHost().getHostVariable() + self.request.path;
   delete self.request.path;
   self.response = clone(mapi.responses[scode]);
   self.response.status = scode;
   self.serial_vars = self.response.serial_vars;
   self.groups = mapi.groups;
   self.groups.push(self.name);
   self.consumes = common.union(getVarNames(self.request),(test.consumes || []));
   self.produces = common.uniq(test.produces || []);
   self.deletes = [];
   self.actions = [];
   self.scanActions(self.response.body,"");
   self.scanActions(test);
   self.onBeforeRun = test.onBeforeRun;
   self.onAfterRun = test.onAfterRun;
   self.before = test.before;
   self.afterApi = test.afterApi;
   self.afterAll = test.afterAll;
   self.scanHook(self.before);
   self.scanHook(self.afterApi);
   self.scanHook(self.afterAll);
}

Api.prototype.getMethod = function() {
   return this.request.method;
};

Api.prototype.getUrl = function() {
   return url.parse("http://host"+this.request.path);
};

Api.prototype.getVirtualHost = function() {
   return this.vhost;
};

Api.prototype.getPredefinedVars = function() {
   return this.mapi.getPredefinedVars();
};

Api.prototype.predefinesVar = function(varName) {
   return this.mapi.predefinesVar(varName);
};

Api.prototype.getOpts = function(request,vars) {
   var self = this;
   if (!request.url && request.path) {
      request.url = '$' + self.getVirtualHost().getHostVariable() + request.path;
      delete request.path;
   }
   var opts = resolve(request,vars);
   opts.method = opts.method || 'GET';
   opts.timeout = opts.timeout || self.hapi.getTimeout();
   opts.headers = opts.headers || {};
   opts.headers.accept = opts.headers.accept || APP_JSON;
   opts.json = isObject(opts.body);
   opts.jar = self.cookieJar;
   return opts;
};

// Throw an error if a field is not defined
Api.prototype.actionCheck = function(action,name,field) {
   if (isArray(field)) {
      var found = false;
      for (var i = 0; i < field.length; i++) {
         if (action[name].hasOwnProperty(field[i])) {
            found = true;
            break;
         }
      }
      if (!found) {
         throw Error(util.format("'%s' has a '%s' without any of the following fields: %j (%j)",this.name,name,field,action));
      }
   } else {
      if (!action[name].hasOwnProperty(field)) {
         throw Error(util.format("'%s' has a '%s' without a '%s' field",this.name,name,field));
      }
   }
};

Api.prototype.scanActions = function(toScan,path) {
   var self = this;
   if (!toScan) return;
   if (isArray(toScan)) {
      for (var idx = 0; idx < toScan.length; idx++) {
         self.scanActions(toScan[idx],path?path+'[]':undefined);
      }
   } else if (isObject(toScan)) {
      var keys = Object.keys(toScan);
      for (var i = 0; i < keys.length; i++) {
         var key = keys[i];
         switch(key) {
         case 'var_new':
            self.actionCheck(toScan,'var_new','name');  // The name of the variable that will contain the id or guid of the new object
            self.actionCheck(toScan,'var_new','get');
            self.actionCheck(toScan,'var_new','delete');
            if (self.var_new) throw Error(util.format("%s contains multiple 'var_new' are not allowed in a single HTTP API",self.name));
            self.var_new = toScan.var_new;
            if (!self.var_new.path) {
               if (!path || path.length === 0) throw Error(util.format("%s contains 'var_new' without a path",self.name));
               self.var_new.path = path;
            }
            self.produces.push(toScan.var_new.name);
            self.hapi.referencedApis.addUniq(toScan.var_new.get);
            self.hapi.referencedApis.addUniq(toScan.var_new['delete']);
            self.actions.push(toScan);
            // By default, the name of the queue which we serialize on when creating an object is the value of all variables
            // that are referenced in the request body.  If there is a case in which there is no request body or if for some
            // reason, there are additional variables in the request body or for some other reason, the default algorithm is
            // not correct, then we require the 'serial_vars' to be explicitly specified in the var_new section.
            if (self.var_new.serial_vars) {
               self.serial_vars = self.var_new.serial_vars;
            } else if (self.requestBodyVars) {
               self.serial_vars = self.requestBodyVars;
            } else {
               throw Error(util.format("var_new for %s needs a 'serial_vars' field",self.name));
            }
            break;
         case 'var_set':
            if (!toScan.var_set.path && !toScan.var_set.fcn) {
               if (!path || path.length === 0) {
                  throw Error(util.format("%s contains a 'var_set' without a path: %j",self.name,toScan.var_set));
               }
               if (isString(toScan.var_set)) {
                  toScan.var_set = {
                     name: toScan.var_set,
                     path: path
                  };
               } else {
                  toScan.var_set.path = path;
               }
            }
            self.produces.push(toScan.var_set.name);
            self.actions.push(toScan);
            break;
         case 'var_rename':
            self.actionCheck(toScan,'var_rename','from');
            self.actionCheck(toScan,'var_rename','to');
            self.deletes.push(toScan.var_rename.from);
            self.produces.push(toScan.var_rename.to);
            self.actions.push(toScan);
            break;
         case 'var_delete':
            var delName = toScan.var_delete;
            toScan.var_delete = { name: delName };
            self.deletes.push(delName);
            self.hapi.varDeleteApis[delName] = self;
            self.actions.push(toScan);
            break;
         }
         var tmpPath = path;
         if (isString(tmpPath) && key !== '__') {
            if (tmpPath.length > 0) tmpPath += '.';
            tmpPath += key;
         } else if (key === 'body') {
            tmpPath = "";
         }
         self.scanActions(toScan[key],tmpPath);
      }
   }
};

// Scan a hook to and insert referenced APIs so that these APIs are not otherwise run.
Api.prototype.scanHook = function(hook) {
   var self = this;
   if (!hook) return;
   if (isArray(hook)) {
      for (var idx = 0; idx < hook.length; idx++) {
         self.scanHook(hook[idx]);
      }
   } else if (isObject(hook)) {
      if (!hook.hook) throw Error("object missing 'hook' field");
      self.scanHook(hook.hook);
   } else if (isString(hook)) {
      self.hapi.referencedApis.addUniq(hook);
   } else if (common.isFunction(hook)) {
      // do nothing
   } else {
      throw Error("invalid hook: "+hook.toString());
   }
};

Api.prototype.getVar = function(name) {
   var val = this.hapi.vars[name];
   if (!val) new Error(util.format("variable '%s' is not set in %s",name,this.name));
   return val;
};

Api.prototype.produces = function(varName) {
   return this.produces.indexOf(varName) >= 0;
};

Api.prototype.toString = function() {
   if (this.var_new) {
      return util.format("%s: consumes=%j, produces=%j, deletes=%j, getApi=%s, deleteApi=%s",
                         this.name,this.consumes,this.produces,this.deletes,
                         this.var_new.get,this.var_new['delete']);
   } else {
      return util.format("%s: consumes=%j, produces=%j, deletes=%j",
                         this.name,this.consumes,this.produces,this.deletes);
   }
};

function Node(hapi,api,parent) {
   this.hapi = hapi;
   this.vhost = api ? api.vhost : undefined;
   this.api = api;
   this.name = api ? api.name : "";
   if (parent) {
      this.path = parent.getPath() + '/' + this.name;
      this.depth = parent.depth + 1;
   } else {
      this.path = this.name;
      this.depth = 0;
   }
   this.indent =  this.depth + ": ";
   for (var i = 1; i < this.depth; i++) this.indent += "   ";
   this.path = parent ? parent.getPath() + '/' + api.name : "";
   this.parent = parent;
   this.children = [];
   this.ancestors = [];
   this.produces = [];              // produced by all nodes from here to the root
   this.subTreeProduces = [];       // produced by all nodes from here to leaves
   if (api) {
      this.addProduces(api.produces.dup());
      this.subTreeProduces.addAllUniq(api.produces);
   }
}

// The 'produces' array of a node contains all the variables that are created
// in the subtree rooted at this node.
Node.prototype.addProduces = function(varNames) {
   if (this.api && this.api.deletes) {
      varNames.pullAll(this.api.deletes);
   }
   this.produces.addAllUniq(varNames);
   if (this.parent) {
      this.parent.addProduces(varNames);
   }
};

Node.prototype.getPath = function() {
   return this.path;
};

// Recursively march down the tree and insert 'api' into every place that produces a variable
// used by this API.  This allows us to get the most complete test coverage.
Node.prototype.insertApi = function(api) {
   var self = this;
   var hapi = self.hapi;

   // Prevent the API from being inserted multiple times
   if (!self.inserting) self.inserting = {};
   if (self.inserting[api.name]) {
      if (log.isDebugEnabled()) log.debug("already inserting API %s",api.name);
      return;
   }
   self.inserting[api.name] = true;

   // If this API is a 'get' or 'delete' associated with a var_new (a constructor), then we don't
   // insert it here.  It is only associated with the API which references it as the getter or destructor
   if (!self.hapi.isInsertableApi(api)) {
      if (log.isDebugEnabled()) log.debug("api '%s' is not insertable", api.name);
      return;
   }

   // If this API is already inserted further up the tree, don't do so again
   if (self.usesApi(api)) {
      return;
   }

   // If this API has no undefined variables, insert it here
   var undefinedVars = self.getUndefinedVars(api);
   if (log.isDebugEnabled()) log.debug("check '%s' to insert '%s', undefinedVars=%s",self.path,api.name,pretty(undefinedVars));
   if (undefinedVars.length === 0) {
      // All variables are defined, so insert it here
      self.addChild(api);
      return;
   }

   // Insert into all subtrees which produce one or more of the undefined variables
   var found = false;
   for (var i = 0; i < self.children.length; i++) {
      var child = self.children[i];
      if (child.producesVar(undefinedVars)) {
         // This child producers one of the variables needed by this API, so insert it here
         child.insertApi(api);
         found = true;
      }
   }

   // If no subtree was found that produces any of the needed variables, then add all producers of the 1st variable
   if (!found) {
      var varName = undefinedVars[0];
      var producers = hapi.getApiProducers(varName);
      if (producers.length === 0) throw Error(util.format("There are no producers of the '%s' variable",varName));
      for (var j = 0; j < producers.length; j++) {
         self.insertApi(producers[j]);
      }
      self.inserting[api.name] = false; // allow it again because we have now added API producers
      self.insertApi(api);
   }
};

// Determine if this Api is used in this node or any of the ancestor nodes
Node.prototype.usesApi = function(api) {
   var node = this;
   while (node) {
      if (node.api === api) return true;
      node = node.parent;
   }
   return false;
};

// Determine if this subtree produces one of the var names
Node.prototype.producesVar = function(varNames) {
   var self = this;
   for (var i = 0; i < varNames.length; i++) {
      if (self.subTreeProduces.includes(varNames[i])) return true;
   }
   return false;
};

Node.prototype.getUndefinedVars = function(api) {
   var self = this;
   var undefinedVars = api.consumes.dup();
   var node = self;
   while (node) {
      if (node.api) undefinedVars.pullAll(node.api.produces);
      node = node.parent;
   }
   undefinedVars.pullAll(api.getPredefinedVars());
   return undefinedVars;
};

Node.prototype.addChild = function(api) {
   var self = this;
   var node;
   for (var i = 0; i < self.children.length; i++) {
      if (self.children[i].api === api) {
         node = self.children[i];
         if (log.isDebugEnabled()) log.debug("previously inserted %s",node.path);
         return node;
      }
   }
   if (self.postRun && api === self.postRun.api) {
      // This API is a delete API and must be run last
      if (log.isDebugEnabled()) log.debug("delete API: %s",self.postRun.path);
      return self.postRun;
   }
   node = new Node(self.hapi,api,self);
   // If there was a var_new on this API, it means this API creates a new object
   // In this case, we init preRun to clean up the object if it was left lying around from a previous run,
   // and a postRun to delete the object (which must be run last).
   var vn = api.var_new;
   if (vn) {
      var getApi = self.hapi.findApi(vn.get,util.format("var_new.get of %s",api.name));
      var deleteApi = self.hapi.findApi(vn['delete'],util.format("var_new.delete of %s",api.name));
      node.preRun = new Node(self.hapi,getApi,node);
      node.preRun.id = self.id ? self.id + '.get' : 'get';
      node.preRun.addChild(deleteApi);
      node.postRun = new Node(self.hapi,deleteApi,node);
      node.postRun.id = self.id ? self.id + '.del' : 'del';
   }
   self.children.push(node);
   node.id = self.id ? self.id + '.' : '';
   node.id += self.children.length;
   // Add the new nodes producers to the subTreeProduces of this node up to the root
   var tmpNode = self;
   while (tmpNode) {
      tmpNode.subTreeProduces.addAllUniq(node.subTreeProduces);
      tmpNode = tmpNode.parent;
   }
   if (log.isDebugEnabled()) log.debug("inserted %s to %s",node.id,node.path);
   return node;
};

Node.prototype.isRoot = function() {
   return !this.api;
};

Node.prototype.dump = function() {
   if (this.api) {
      if (log.isInfoEnabled()) log.info("%s) %s",this.id,this.api.toString());
   }
   for (var i = 0; i < this.children.length; i++) {
      this.children[i].dump();
   }
};

/*
 * At runtime, the TestContext provides an interface for passing data
 * to user hooks such as onBeforeRun.
 */
function TestContext(vars,testName) {
   this._vars = vars;
   this.testName = testName;
   this.logger = log;
}

TestContext.prototype.getVar = function (name) {
   return this._vars[name];
};

TestContext.prototype.setVar = function (name, value) {
   this._vars[name] = value;
};
/*
 * At runtime, the RunContext contains the value of variables to run
 * with as we execute through the compile time tree.
 */
function RunContext(vars,node,index,length,parent,ignoreFailures) {
   this.vars = vars;
   this.node = node;
   this.index = index;
   this.parent = parent;
   this.ignoreFailures = ignoreFailures;
   if (!ignoreFailures && parent) this.ignoreFailures = parent.ignoreFailures;
   if (parent) {
      if (length > 1) {
         this.name = parent.name + ":" + index + "/" + node.name;
      } else {
         this.name = parent.name + "/" + node.name;
      }
   } else {
      if (length > 1) {
         this.name = node.name + ":" + index;
      } else {
         this.name = node.name;
      }
   }
   this.api = node.api;
   if (this.api) {
      this.status = strToInt(this.api.response.status);
      this.actions = this.api.actions;
      this.ignoreBody = this.api.response.ignore_body;
   }
   this.hapi = node.hapi;
   this.indent = ""; //node.indent;
   this.id = index > 0 ? node.id + '-' + index : node.id;
}

RunContext.prototype.getOpts = function(api) {
   var self = this;
   api = api || self.api;
   // Perform variable substitution across everything in the HAPI's request section
   if (log.isDebugEnabled()) {
      var vars = common.pick(self.vars, common.union(api.consumes, api.produces));
      log.debug("resolving request variables for %s: request=%j\n variables=%s",self.name,api.request,pretty(vars));
   }
   return api.getOpts(api.request,self.vars);
};

RunContext.prototype.run = function(cb) {
   var self = this;
   if (!self.api) {
      return self.doRun(cb);
   }
   var varsArray = getVarCombinations(self.vars,self.api.consumes);
   if (varsArray.length === 0) throw Error(util.format("no var combinations for api %s",self.api.name));
   if (varsArray.length === 1) {
      self.doRun(function(err) {
         if (self.ignoreFailures) return cb();
         cb(err);
      });
   } else {
      async.forEachOfSeries(
            varsArray,
            function(vars,index,cb) {
               var ctx = new RunContext(vars,self.node,index,varsArray.length,self.parent);
               ctx.doRun(cb);
            },
            function(err) {
               if(err && !err.handled) {log.error(err);}
               if (self.ignoreFailures) return cb();
               cb(err);
            }
         );
   }
};

RunContext.prototype.doHook = function (api, hook, cb) {
   var self = this;
   if (!hook) { return cb(); }
   if (log.isDebugEnabled()) log.debug("invoking %s for %s", getFunctionName(hook), api.name);

   try {
      var ctx = new TestContext(self.vars,api.name);
      var _cb = function (err) {
         try {
            if (!err) {
               // not sure we can guarantee vars and ctx._vars are the same object
               self.vars = ctx._vars;
               self.opts = resolve(api.request, self.vars);
            }
         } catch (ex) {
            err = ex;
         }
         if (cb) { cb(err); }
      };
      hook(ctx, _cb);
   } catch (ex) {
      log.error(pretty(ex));
      if (cb) { cb(ex); }
   }
};

RunContext.prototype.runHook = function (name, hook, cb) {
   var self = this;
   if (!hook) {
      if (log.isDebugEnabled()) log.debug("runHook: no %s",name);
      return cb();
    }
   var where = util.format("%s:%s",self.api.name,name);
   var ctx = new HookContext(self.vars,self);
   self.runHook2(name,hook,ctx,function(err) {
      if (err) log.error("%s.%s) HOOK FAILED: error=%j",self.id,name,err);
      else log.info("%s.%s) HOOK PASSED",self.id,name);
      return cb(err);
   });
};

RunContext.prototype.runHook2 = function (name, hook, ctx, cb) {
   var self = this;
   if (!hook) {
      if (log.isDebugEnabled()) log.debug("runHook2: no %s",name);
      return cb();
    }
   var where = util.format("%s:%s",self.api.name,name);
   if (log.isDebugEnabled()) log.debug("runHook2: %s",where);
   ctx = ctx || new HookContext(self.vars,self);
   if (isArray(hook)) {
      var idx = ctx.index || 0;
      if (idx >= hook.length) return cb();
      ctx.ignore = idx < hook.length - 1;
      self.runHook2(
         name+'['+idx+']',
         hook[idx],
         ctx,
         function(err) {
            if (err) return cb(err);
            if (ctx.isBreak()) return cb();
            ctx.index = idx + 1;
            return self.runHook2(name, hook, ctx, cb);
         }
      );
   } else {
      if (!isObject(hook)) {
         hook = {hook:hook};
      } else if (!hook.hasOwnProperty('hook')) {
         throw Error(util.format("missing 'hook' field at %s",where));
      }
      if (!hook.hasOwnProperty('quit')) {
         hook.quit = ctx.ignore ? [404] : [];
      }
      if (isString(hook.hook)) {
         var api = self.hapi.findApi(hook.hook,name);
         hook.hook = function(ctx) {
            var node = new Node(self.hapi,api,self.node);
            node.id = self.id ? self.id + '.' + where: where;
            var runCtx = new RunContext(ctx.vars,node,0,1,self);
            runCtx.run(function(err) {
               if (err) {
                  // If the status code is in the list of those which should cause us to silently
                  // quit, do so; otherwise, throw an error.
                  if (hook.quit.indexOf(runCtx.statusCode)) ctx.setBreak(true);
                  else return cb(err);
               }
               return cb();
            });
         };
      } else if (!common.isFunction(hook.hook)) {
         throw Error(util.format("'hook' field at %s must be either a string or a function",name));
      }
      // Invoke the hook function
      try {
         hook.hook(ctx,function(err) {
            if (err) throw err;
            return cb();
         });
      } catch (ex) {
         log.error(pretty(ex));
         if (cb) { cb(ctx.fatal?ex:null); }
      }
   }
};

// Perform the main run, including running all children
RunContext.prototype.doRun = function(callback,proceed) {
   var self = this;
   var node = self.node;
   var api = node.api;
   if (!api) {
      return self.runChildren(callback);
   }
   // If this has a queue name, then we need to enforce serialization.
   var queue;
   var hapi = self.hapi;
   var queueName = self.getSerialQueueName();
   if (queueName && !proceed) {
      queue = hapi.serialQueues[queueName];
      if (!queue) {
         hapi.serialQueues[queueName] = queue = [];
      }
      queue.push({ctx:self,cb:callback});
      if (queue.length > 1) {
         // Someone else is currently running, so we need to wait
         log.debug("QUEUE: %s is waiting in queue %s for api %s",self.name,queueName,api.name);
         return;
      } else {
         // We are 1st in the queue, so we run now
         log.debug("QUEUE: %s is running in queue %s for api %s",self.name,queueName,api.name);
      }
   }
   log.debug("doRun running api %s, name=%s",api.name,self.name);
   var state = 0;
   var cbErr;
   async.waterfall([
      // preRun (allows for pre-cleanup which normally means doing a 'get' and if found a 'delete')
      function(cb) {  // state 1
         if (!node.preRun) {
            state = 1;
            return cb();
         }
         log.debug("doRun begin preRun %s",api.name);
         var ctx = new RunContext(self.vars,node.preRun,0,1,self,true);  // final 'true' causes failures to be ignored
         ctx.run(function(err) {
            log.debug("doRun end preRun %s: err=%j",api.name,err);
            if (!err) state = 1;
            else if (!cbErr) cbErr = err;
            return cb();
         });
      },
      // onBeforeRun hook
      function(cb) { // state 2
         if (state < 1) return cb();
         self.doHook(api, self.api.onBeforeRun, function(err) {
            if (!err) state = 2;
            else if (!cbErr) cbErr = err;
            return cb();
         });
      },
      // before hook
      function(cb) { // state 3
         if (state < 2) return cb();
         self.runHook("before", self.api.before, function(err) {
            if (!err) state = 3;
            else if (!cbErr) cbErr = err;
            return cb();
         });
      },
      // main
      function(cb) { // state 4
         if (state < 3) return cb();
         log.debug("doRun main %s",api.name);
         self.sendRequest(function(err) {
            if (!err) state = 4;
            else if (!cbErr) cbErr = err;
            return cb();
         });
      },
      // afterApi hook
      function(cb) { // state 5
         if (state < 4) return cb();
         self.runHook("afterApi", self.api.afterApi, function(err) {
            if (!err) state = 5;
            else if (!cbErr) cbErr = err;
            return cb();
         });
      },
      // children
      function(cb) { // state 6
         if (state < 5) return cb();
         self.runChildren(function(err) {
            if (!err) state = 6 ;
            else if (!cbErr) cbErr = err;
            return cb();
         });
      },
      // afterAll hook
      function(cb) {
         if (state < 5) return cb();
         self.runHook("afterAll", self.api.afterAll, function(err) {
            if (!cbErr) cbErr = err;
            return cb();
         });
      },
      // onAfterRun hook
      function(cb) {
         if (state < 2) return cb();
         self.doHook(api, self.api.onAfterRun, function(err) {
            if (!cbErr) cbErr = err;
            return cb();
         });
      },
      // postRun
      function(cb) {
         if (!node.postRun || (state < 3)) return cb();
         if (log.isDebugEnabled()) log.debug("doRun postRun %s",api.name);
         var ctx = new RunContext(self.vars,node.postRun,0,1,self);
         ctx.run(function(err) {
            if (!cbErr) cbErr = err;
            return cb();
         });
      },
      // Check the serial queue
      function(cb) {
         if (queue) {
            var ele = queue.shift();  // remove self
            if (ele.ctx !== self) throw Error("program error: ctx should equal self");
            log.debug("QUEUE: %s is finished in queue %s for api %s",self.name,queueName,api.name);
            if (queue.length > 0) {
               // Let the next RunContext in the queue run now
               ele = queue[0];
               log.debug("QUEUE: %s is resuming in queue %s by api %s",ele.ctx.name,queueName,api.name);
               ele.ctx.doRun(ele.cb,true);
            }
            if (log.isDebugEnabled()) log.debug("%s finished queue %s for api %s",self.name,queueName,api.name);
         }
         // We also continue to the next stage
         cb(cbErr);
      }
   ], function(e){callback(e);});
};

// Run all children in parallel
RunContext.prototype.runChildren = function(cb) {
   var self = this;
   if (log.isDebugEnabled()) log.debug("%srunChildren: %s",self.indent,self.name);
   async.each(
      self.node.children,
      function(node,cb) {
         var ctx = new RunContext(clone(self.vars),node,0,1,self);
         ctx.run(cb);
      },
      cb
   );
};

// Get the name of the queue, if any, to serialize on when running this context.
// The only known case for needing this currently is when two objects are of the same "name" are being created
// multiple times.  We need to serialize these types of calls.
// There may be additional reasons for needing to serialize in the future, in which case the name of the
// queue may be tweaked to accomplish this.
// The less unique the queue name, the more serialization you have.
RunContext.prototype.getSerialQueueName = function() {
   var self = this;
   var api = self.node.api;
   if (!api || !api.serial_vars) return null;
   var queueName = "";
   var svars = api.serial_vars;
   for (var i = 0; i < svars.length; i++) {
      if (i > 0) queueName += ',';
      var varName = svars[i];
      var varVal = self.vars[varName];
      if (!varVal) throw Error("serial_vars "+varName+" does not have a value");
      queueName += varName + '=' + varVal;
   }
   return queueName;
};

RunContext.prototype._sendRequest = function (cb) {
   var self = this;
   var response = {};
   request(self.opts, function(err,resp,body) {
      try {
         if (err) throw err;
         response.headers = resp.headers;
         response.body = body;
         response.statusCode = resp.statusCode;
         response.expectedStatusCode = self.status;
         var contentType = response.headers['content-type'] ? response.headers['content-type'].toLowerCase() : '';
         // If response is JSON, parse it
         if (contentType && contentType.startsWith(APP_JSON) && isString(body)) {
            try {
               body = JSON.parse(body);
            } catch (err2) {
               throw Error(util.format("error parsing JSON response from %s: error=%s, body=%j",self.name,err2,body));
            }
         }
         var statusCode = resp.statusCode;
         self.handleResponse(body,statusCode,contentType);
         self.logTestPass(response);
      } catch (reqErr) {
         err = reqErr;
         if (self.ignoreFailures) {
            var errMsg = reqErr ? reqErr.toString() : '';
            if (log.isDebugEnabled()) log.debug("%sfailed %s: %s",self.indent,self.name,errMsg);
         } else {
            self.logTestFailure(reqErr,response);
         }
      }
      if (self.node === self.parent.node.preRun && err) {
         log.debug("ignoring errors for preRun %s", self.name);
        // err = null;
      }
      // err should be null on pass
      if (cb) { cb(err); }
   }); // end request()
};

RunContext.prototype.sendRequest = function(cb) {
   var self = this;
   try {
      self.opts = self.getOpts();
   } catch(e) {
      self.logTestFailure(e,null);
      if (cb) { cb(e); }
      return;
   }
   try {
      // Send the request
      if (log.isDebugEnabled()) log.debug("%sREQUEST: sending request for '%s': %s",self.indent,self.name,pretty(self.opts));
      self._sendRequest(cb);
   } catch (e) {
      self.logTestFailure(e, null);
      if (cb) { cb(e); }
   }
};

RunContext.prototype.handleResponse = function(body, statusCode, contentType) {
   // Exceptions in handleResponse should be handled by invoker.
   var self = this;
   var opts = self.opts;
   if (log.isDebugEnabled()) {
      log.debug("%sRESPONSE: received response for test %s, reqUrl=%s, responseBody=\n%s%s",
                 self.indent,self.name,opts.url,self.indent,pretty(body));
   }
   if (statusCode != self.status) {
      self.statusCode = strToInt(statusCode);
      throw Error(util.format("invalid status code: received=%d, expected=%d",statusCode,self.status));
   }
   // Execute response actions
   if (self.actions) {
      self.performActions(contentType, body);
   } else {
      if (log.isDebugEnabled()) log.debug("no actions for test %s",self.name);
   }
   // Check the response received against the documented response body.
   if (!self.ignoreBody) self.checkBody(body);
};

RunContext.prototype.logTestPass = function (response) {
   if (this.ignoreFailures) {
      if (log.isDebugEnabled()) log.debug("%spassed: %s",this.indent,this.name);
   }
   else {
      if (log.isTraceEnabled()) log.trace("\n");
      if (log.isInfoEnabled()) log.info("%s) TEST PASSED: %s",this.id,this.name);
      if (log.isTraceEnabled()) log.trace("%s     REQUEST: %s", this.indent, pretty(this.opts));
      if (response) {
         // hand case where the response body is not JSON;
         // TODO: check content type
         if (response.body && isString(response.body)) {
            try {
               response.body = JSON.parse(response.body);
            } catch (e) {}
         }
         if (log.isTraceEnabled()) log.trace("%s     RESPONSE: %s", this.indent, pretty(response));
      }
   }
};

RunContext.prototype.logTestFailure = function (err, response) {
   // most of the stack is the event loop, which is meaningless
   err.handled = true;
   var errMsg = (log.isTraceEnabled() && err.stack) ? err.stack.split('at Request._callback')[0] : err.toString();
   if (log.isTraceEnabled()) log.trace("\n");
   log.error("%s) TEST FAILED: %s: %s", this.id, this.name, errMsg);
   log.addTimeStamp = false;
   if (log.isInfoEnabled()) log.info("%s     REQUEST: %s", this.indent, pretty(this.opts));
   if (response) {
      try {
         if (response.body && isString(response.body)) {
           response.body = JSON.parse(response.body);
         }
      } catch (e) { }
      if (log.isInfoEnabled()) log.info("%s     RESPONSE: %s", this.indent, pretty(response));
   }
   log.addTimeStamp = true;
};

RunContext.prototype.checkBody = function(body) {
   var schema = getBodySchema(this.api.response);
   if (log.isDebugEnabled()) log.debug("schema: %s",pretty(schema));
   this._checkBody(body,schema,"");
};

RunContext.prototype._checkBody = function(body,schema,path) {
   if (!schema) {
      if (!body) return;
      throw Error(util.format("the following response body was not documented: ",pretty(body)));
   }
   if (schema.ignore) return;
   var res = tv4.validateMultiple(body, schema, true, true);
   if (!res.valid) {
      // stack never changes, hence useless noise
      res.errors.forEach(function (e) {
         delete e.stack;
      });

      res.schema = schema;
      throw Error("VALIDATION FAILURE: " + pretty(res));
   }
};

RunContext.prototype.checkArray = function(obj,path,fcn) {
   var self = this;
   if (!isArray(obj)) throw Error(util.format("the '%s' field must be an array",path));
   for (var i = 0; i < obj.length; i++) {
      var ele = obj[i];
      self.checkType(ele,path+'['+i+']',fcn,ele);
   }
};

RunContext.prototype.checkType = function(obj,path,fcn,type) {
   if (!fcn(obj)) {
      throw Error(util.format("expecting %s in '%s' field of response body, but found %j",type,path,obj));
   }
};

// Attempt to perform response actions.
RunContext.prototype.performActions = function(contentType,body) {
   var self = this;
   for (var i = 0; i < self.actions.length; i++) {
      var action = self.actions[i];
      if (action.var_new || action.var_set) {
         action = action.var_new || action.var_set;
         var name = action.name;
         var value;
         if (action.value) {
            value = resolve(action.value,self.vars);
         } else if (action.path) {
            checkForJsonResponse(contentType,body);
            value = getVal(body,action.path);
         } else if (action.fcn) {
            checkForJsonResponse(contentType,body);
            value = action.fcn(body);
         } else {
            throw Error(util.format("action does not contain 'value', 'path', nor 'fcn' field: %j",action));
         }
         self.setVar(name,value);
      } else if (action.var_rename) {
         action = action.var_rename;
         self.renameVar(action.from,action.to);
      } else if (action.var_delete) {
         action = action.var_delete;
         self.delVar(action.name);
      } else {
         throw Error(util.format("invalid action for %s: %j",self.name,action));
      }
   }
};

RunContext.prototype.setVar = function(name,val) {
   var oldVal = this.vars[name];
   this.vars[name] = val;
   if (log.isDebugEnabled()) {
      if (oldVal) {
         log.debug("%stest %s changed '%s' from '%s' to '%s'",this.indent,this.name,name,oldVal,val);
      } else {
         log.debug("%stest %s set '%s' to '%s'",this.indent,this.name,name,val);
      }
   }
};

RunContext.prototype.renameVar = function(from,to) {
   var val = this.vars[from];
   delete this.vars[from];
   this.vars[to] = val;
   if (log.isDebugEnabled()) log.debug("%stest %s renamed %s to %s",this.indent,this.name,from,to);
};

RunContext.prototype.delVar = function(name) {
   delete this.vars[name];
   if (log.isDebugEnabled()) log.debug("%stest %s deleted %s",this.indent,this.name,name);
};

/*
 * At runtime, the HookContext provides an interface for passing data to user hooks
 * such as before and after.
 */
function HookContext(vars,runContext) {
   this.vars = vars;
   this.api = runContext.api;
   this.break = false;
}

HookContext.prototype.getVar = function (name) {
   return this.vars[name];
};

HookContext.prototype.setVar = function (name, value) {
   this.vars[name] = value;
};

HookContext.prototype.isBreak = function () {
   return this.break;
};

HookContext.prototype.setBreak = function (breakVal) {
   this.break = breakVal;
};

HookContext.prototype.sendRequest = function(opts,cb) {
   var self = this;
   opts = self.api.getOpts(opts,this.vars);
   if (log.isDebugEnabled()) log.debug("HOOK REQUEST: %j",opts);
   request(opts,function(err,response,body) {
      if (log.isDebugEnabled()) log.debug("HOOK RESPONSE: request=%j, err=%j, response=%j, body=%j",opts,err,response,body);
      cb(err,response,body);
   });
};

/*
 * HapiLoader stands for "HTTP API Loader".
 * It can be used in either of two ways:
 * 1) by Hapi directly, to load API tests from disk to run;
 * 2) by a node.js application to return the API tests via a REST call to the server, which Hapi then runs.
 */
function HapiLoader() {
   this.info = {};
   this.errors = [];
}

HapiLoader.prototype.loadFromDir = function(dir) {
   var self = this;
   dir = path.resolve(dir);
   var hapiPath = dir + '/hapi.js';
   if (!isFile(hapiPath)) {
      self.errors.push(util.format("hapi.js file not found in input directory: %s",dir));
      return;
   }
   var hapi = require(hapiPath);
   if (!hapi.hapi) {
      self.errors.push(util.format("file '%s' has no 'hapi' section: %j",hapiPath,hapi));
      return;
   }
   this.info = this._loadDir(dir,"");
};

HapiLoader.prototype.getInfo = function() {
   return this.info;
};

HapiLoader.prototype.getErrors = function() {
   return this.errors;
};

HapiLoader.prototype.addRoute = function(app,path) {
   var self = this;
   app.get(path, function(req,res) {
      res.json(self.info);
   });
   return self;
};

HapiLoader.prototype.main = function() {
   var argv = process.argv.slice(2);
   if (argv.length !== 1) usage(util.format("HapiLoader: number of arguments is %d but expecting 1",argv.length));
   var hl = new HapiLoader();
   hl.loadFromDir(argv[0],true);
   console.log("%s",JSON.stringify(hl.getInfo(),0,3));
   var errors = hl.getErrors();
   if (errors.length > 0) {
      console.log(util.format("ERRORS: %j",errors));
   }
};

/*
 * Factory for glob options object.
 */
function buildGlobOpts (dir) {
   // Tell glob to use the hapi dir as its cwd, and ignore files for which
   // we have special handling. We then check for an .hdtignore file, which
   // allows users to exclude files from tests.
   var globOpts = {cwd:dir, mark:false, ignore:['**/swagger-*']};

   if (existsSync(dir + '/.hdtignore')) {
      var patterns = fs.readFileSync(dir + '/.hdtignore', 'utf8').split('\n');
      if (patterns && patterns.length > 0) {
         patterns.forEach(function (p) {
            globOpts.ignore.push(common.trim(p));
         });
      }
   }

   return globOpts;
}

/*
 * Return the 'js' and 'json' contents of the HAPI directory as a single JSON response.
 */
HapiLoader.prototype._loadDir = function(dir) {
   var self = this;
   var scopeHapis = { elements:[] };
   var allHapis = scopeHapis;

   try {
      var globalPattern = '{*/,**/*.js,**/*.json}';
      var globOpts = buildGlobOpts(dir);
      // Process files & directories that match our pattern
      glob.sync(globalPattern, globOpts).forEach(function(file) {
         var path = dir + '/' + file;

         // handle magic hapi file
         if (path.endsWith('/hapi.js')) {
            var hapi = require(path);
            if (hapi.hapi) {
               for (var key in hapi.hapi) {
                  scopeHapis[key] = hapi.hapi[key];
               }
            }
         } else if (isDir(path)) {
            scopeHapis = { elements:[] };
            allHapis.elements.push({
               type: "elements",
               name: file,
               value: scopeHapis
            });
         } else {
            try {
               scopeHapis.elements.push({
                  type: "api",
                  name: file.substring(0,file.lastIndexOf('.')),
                  value: require(path)
               });
            } catch (err) {
               self.errors.push(util.format("failed loading file %s in directory %s: %s",file,dir,err));
            }
         }
      });
   } catch (err) {
      self.errors.push(util.format("failed loading directory %s: %s",dir,err));
   }
   return allHapis;
};



/*
 * Get a test request.
 */
function getTestReq(testReq,vars,req) {
   if (testReq) {
      return merge(testReq,req);
   } if (vars) {
      return getObjectWithVarsReplaced(req,vars);
   } else {
      return req;
   }
}

// Return an array of variables found in 'input'
function getVarNames(input) {
   var varList = [];
   scanForVars(input,varList);
   return varList;
}

// Scan 'input' for variable names and add them to the 'varList' array
function scanForVars(input,varList) {
   if (!input) return;
   if (isString(input)) {
      var matches = getMatches(input);
      matches.forEach(function(varStr) {
         varList.addUniq(normalizeVar(varStr));
      });
   } else if (isArray(input)) {
      input.forEach(function(ele) {
         scanForVars(ele,varList);
      });
   } else if (isObject(input)) {
      forAll(input,function(key,val) {
         scanForVars(val,varList);
      });
   }
}

// Given a request or response object, return the schema for the body in JSON schema syntax
function getBodySchema(requestOrResponse,vars) {
   if (requestOrResponse.body_schema) {
      // It was declared using JSON schema syntax directly
      return requestOrResponse.body_schema;
   }
   var body = requestOrResponse.body;
   if (body) {
      // It was declared using the more-friendly syntax with optional bodymd amending it
      var bodymd = requestOrResponse.bodymd;
      var map = {};
      var schema = bodyToJsonSchema(body,map,"",vars);
      processBodymd(bodymd,map);
      setSchemaRequiredArray(schema);
      return schema;
   }
   return null;
}

// Given a schema and a definitions section, return the reference to the body schema in the
// definitions section.  This is used for gendoc only.
function getSchemaRef(schema,defs) {
   if (!schema) return null;
   if (!SCHEMA_REFS) return schema;
   // Find or put the result in the definitions section
   var key;
   var keys = Object.keys(defs);
   for (var i = 0; i < keys.length; i++) {
      if (lodash.isEqual(defs[keys[i]],schema)) {
         key = keys[i];
         break;
      }
   }
   if (!key) {
      // not found, so add to definitions section
      key = keys.length + 1;
      defs[key] = schema;
   }
   return {
      type: "object",
      "$ref": "#/definitions/"+key
   };
}

function processBodymd(bodymd,map) {
   if (!bodymd) return;
   if (!isObject(bodymd)) throw Error(util.format("bodymd value must be an object but found %j",bodymd));
   forAll(bodymd,function(path,md) {
      var entry = map[path];
      if (!entry) throw Error(util.format("path '%s' was not found in body",path));
      merge(entry,md,true);
      if (entry.anyOf) { delete entry.type; }
   });
}

// Translate the 'body' syntax to JSON schema syntax
function bodyToJsonSchema(body,map,path,vars) {
   if (!body) return null;
   var result;
   if (isString(body)) {
      result = getDocInfo(body,'string',vars);
   } else if (isArray(body)) {
      var items,description,arrayDoc;
      switch(body.length) {
      case 1:
         items = bodyToJsonSchema(body[0],map,path+'[0]',vars);
         description = util.format("An array of %s items",items.description || "unique");
         arrayDoc = {type:"array",description:description,items:items};
         arrayDoc.required = true;
         result = arrayDoc;
         break;
      case 2:
         items = bodyToJsonSchema(body[1],map,path+'[1]',vars);
         description = util.format("An array of %s items",items.description || "unique");
         arrayDoc = getDocInfo(body[0],'array');
         arrayDoc.items = items;
         arrayDoc.description = arrayDoc.description || description;
         result = arrayDoc;
         break;
      default:
         throw Error("array must have 1 or 2 elements, but found "+body.length);
      }
   } else if (isObject(body)) {
      var obj,props;
      var keys = Object.keys(body);
      if ((keys.length === 1) && (keys[0] === '*')) {
         obj = {
            "patternProperties": {
               "^.+$": bodyToJsonSchema(body['*'],map,path?path+'.*':'*',vars)
            }
         };
      } else {
         if (isObject(body.__)) {
            obj = normalizeDocEle(body.__,map,path);
            obj.properties = props = {};
            if (!obj.hasOwnProperty('required')) obj.required = true;
         } else {
            props = {};
            obj = {type:"object",properties:props,required:true};
         }
         forAll(body,function(key,val) {
            val = bodyToJsonSchema(val,map,path?path+'.'+key:key,vars);
            props[key] = val;
         });
      }
      result = obj;
   } else {
      throw Error(util.format("unexpected type for %j",body));
   }
   map[path] = result;
   return result;
}

// This is called when generating swagger doc only to convert the
// individual 'required' statements to the array format expected
// by swagger
function setSchemaRequiredArray(schema) {
   if (schema.type === 'object') {
      var required = [];
      forAll(schema.properties, function(key,val) {
         if (val) {
            if (val.required) {
               required.push(key);
            }
            delete val.required;
            setSchemaRequiredArray(val);
         }
      });
      if (required.length > 0) {
         schema.required = required;
      } else {
         delete schema.required;
      }
   } else if (schema.type === 'array') {
      setSchemaRequiredArray(schema.items);
   } else {
      delete schema.required;
   }
}

function getDocInfo(str,defaultType,vars) {
   defaultType = defaultType || 'string';
   if (vars) {
      // Resolve any variables to the description of the variable
      str = resolveStr(str,function(varName) {
         var vinfo = vars[varName];
         if (!vinfo) throw Error("undefined variable: %s",varName);
         if (!vinfo.description) throw Error("variable has no description: %s",varName);
         return vinfo.description;
      });
   }
   var doc = {
         type: defaultType,
         description: str,
         required: true
   };
   if (str.startsWith('(')) {
      var endIdx = str.indexOf(')');
      if (endIdx > 0) {
         var flags = str.substring(1,endIdx).split(',');
         doc.description = endIdx <= str.length ? str.substring(endIdx+1) : undefined;
         for (var i = 0; i < flags.length; i++) {
            var flag = flags[i].trim();
            switch(flag) {
            case 'a': doc.type = 'array'; break;
            case 'b': doc.type = 'boolean'; break;
            case 'ba': buildArraySchema(doc, 'boolean'); break;
            case 'dt': doc.type = 'date-time'; break;
            case 'dts': doc.type = 'string'; doc.format = 'date-time'; break;
            case 'i': doc.type = 'integer'; break;
            case 'ia': buildArraySchema(doc, 'integer'); break;
            case 'o': doc.type = 'object'; break;
            case 's': doc.type = 'string'; break;
            case 'sa': buildArraySchema(doc, 'string'); break;
            case 'opt': doc.required = false; break;
            case 'req': doc.required = true; break;
            case 'ign': return {format:FORMAT_IGNORE};
            default: throw Error(util.format("invalid flag '%s' in %j",flag,str));
            }
         }
         if (!doc.required) {
            // This conflates 'optional' with 'nullable', while the JSON schema spec treats them separately, ie
            // a required property can be nullable and an optional property can not be nullable. If a tester
            // desires that level of granularity, can should use 'body_schema'
            doc.type = [doc.type, "null"];
         }
      }
   }
   return doc;
}

function buildArraySchema(doc, itemType) {
   doc.type = "array";
   doc.items = { "type": itemType };
   return doc;
}

var eleTypes = {
   array: { contentsField: 'items' },
   object: {contentsField: 'properties' },
   string: {},
   boolean: {},
   integer: {},
   'date-time': {}
};

function normalizeDocEle(doc,map,path) {
   doc = clone(doc);
   if (!doc.type) doc.type = 'string';
   var eleType = eleTypes[doc.type];
   if (!eleType) throw Error(util.format("unsupported type: %s",doc.type));
   var cf = eleType.contentsField;
   if (cf) {
      var contents = doc[cf];
      if (!contents) throw Error(util.format("'%s' element is missing the '%s' field: %j",doc.type,cf,doc));
      doc[cf] = bodyToJsonSchema(contents,map,path);
   }
   // Strip the 'var_' fields.  These fields pertain to testing, not to documentation
   for (var key in doc) {
      if (key.startsWith("var_")) delete doc[key];
   }
   if (!doc.hasOwnProperty('required')) {
      doc.required = true;
   }
   return doc;
}

/**
 * Given a set of variables and names of variables which will be accessed,
 * return an array of all possible variable combinations
 * For example:
 *    getVarCombinations({var1: ['a','b'], var2: ['c','d'], var3: 'xyz'},
 *                       ['var1','var2']);
 * Returns an array of 4 elements as follows:
 *   [ {"var1":"a","var2":"c","var3":"xyz"},
 *     {"var1":"a","var2":"d","var3":"xyz"},
 *     {"var1":"b","var2":"c","var3":"xyz"},
 *     {"var1":"b","var2":"d","var3":"xyz"} ]
 * @param vars A set of variables.  If the value is an array, assume it means it could be any of those values.
 * @param names Names of the variables to check and vary across all of their values.
 * @returns
 */
function getVarCombinations(vars,names) {
   var varsArray = [vars];
   if (!isArray(names)) return varsArray;
   var combinations = getVarCombinationsRecurse(varsArray,names);
   if (log.isTraceEnabled()) {
      log.trace("getVarCombinations:\n   # of combinations=%d\n   names=%s,\n   vars=%s",combinations.length,pretty(names),pretty(vars));
   } else if (log.isDebugEnabled() && names && names.length > 0) {
      log.debug("getVarCombinations:\n   # of combinations=%d\n   names=%s,\n   vars=%s",combinations.length,pretty(names),pretty(vars));
   }
   return combinations;
}

function getVarCombinationsRecurse(varsArray,names) {
   var name = names.shift();
   if (!name) return varsArray;
   var newVarsArray = [];
   for (var i = 0; i < varsArray.length; i++) {
      var vars = varsArray[i];
      var val = vars[name];
      if (isArray(val)) {
         for (var j = 0; j < val.length; j++) {
            var newVars = clone(vars);
            newVars[name] = val[j];
            newVarsArray.push(newVars);
         }
      } else {
         newVarsArray.push(vars);
      }
   }
   return getVarCombinationsRecurse(newVarsArray,names);
}

/**
 * Perform variable substitution
 * @param toResolve A string with "$var" form variables
 * @param vars The values of the variable names to use in substitution
 * This keeps resolving until there is no change.  This is not efficient but is easy to implement.
 * @returns
 */
function resolve(toResolve,vars) {
   var val1 = resolve2(toResolve,vars);
   for (var count = 1; count < 50; count++) {
      var val2 = resolve2(val1,vars);
      if (lodash.isEqual(val1,val2)) return val1;
      val1 = val2;
   }
   throw Error(util.format("unable to fully resolve variables in: %s",val1));
}

function resolve2(toResolve,vars) {
   if (!toResolve || !vars) return toResolve;
   if (isString(toResolve)) {
      toResolve = resolveStr(toResolve,function(varName) {
         var val = vars[varName];
         if (val === undefined) throw Error(util.format("variable '%s' is not defined",varName));
         return vars[varName];
      });
      return toResolve;
   } else if (isArray(toResolve)) {
      var list = [];
      toResolve.forEach(function(ele) {
         list.push(resolve2(ele,vars));
      });
      return list;
   } else if (isObject(toResolve)) {
      var obj = {};
      forAll(toResolve,function(key,val) {
         key = resolve2(key,vars);
         val = resolve2(val,vars);
         obj[key] = val;
      });
      return obj;
   } else {
      return toResolve;
   }
}

function resolveStr(str,resolverFcn) {
   var matches = getMatches(str);
   for (var i = 0; i < matches.length; i++) {
      var varStr = matches[i];
      var varName = normalizeVar(varStr);
      var varVal = resolverFcn(varName);
      str = str.replace(varStr,varVal);
   }
   return str;
}

/*
 * Get a value from 'obj' corresponding to the path identified by 'str'.
 * For example, the following returns "foo":
 *   getVal({ a: [ { b : "foo" } ] } , "a[0].b" )
 */
function getVal(obj,str) {
   if (!str) return obj;
   var origObj = obj;
   var part,lastSep;
   var path = "";
   var sep = "";
   while(str) {
      lastSep = sep;
      var idx = str.search(/\.|\[|\]/);
      if (idx >= 0) {
         part = str.substring(0,idx);
         sep = str.substring(idx,idx+1);
         str = str.substring(idx+1);
      } else {
         part = str;
         sep = null;
         str = null;
      }
      path += lastSep + part;
      if (lastSep === '[') path += ']';
      if (part.length === 0) {
         if ((lastSep == '[') && (sep == ']')) {
            var result = [];
            for (var j = 0; j < obj.length; j++) {
               result.push(getVal(obj[j],str));
            }
            if (result.length === 0) throw Error(util.format("'%s' is an empty array in %s",path,pretty(origObj)));
            return result;
         }
         continue;
      }
      if (!obj[part]) throw Error(util.format("'%s' was not found in %s",path,pretty(origObj)));
      obj = obj[part];
   }
   return obj;
}

/*
 * Resolve the values of the variables as much as possible.
 * Note that a variable's values may be defined in terms of another variable whose
 * value is already known.  In this case, we resolve to the next level.
 * We also remove the "value" field level that is found in the variables definition.
 * For example, given the following (which is the format of variables definition in hapi.js):
 *    { var1: { value: ['$var2','$var3'] },
 *      var2: { value: ['foo','$var4'] },
 *      var3: { value: 'bar' },
 *      var4: { }
 * Return the following:
 *    { var1: ['foo','$var4','bar'],
 *      var2: ['foo','$var4'],
 *      var: 'bar',
 *      var4: undefined }
 */
function getVarValues(vars) {
   var result = {};
   for (var name in vars) {
      result[name] = getVarValue(name,vars);
   }
   return result;
}

function getVarValue(name,vars) {
   if (!isString(name)) throw Error(util.format("not a string: %j",name));
   if (name.startsWith('$')) name = name.substring(1);
   var val = vars[name];
   if (!val) {
      // If the variable name is not defined, then throw an error
      // All referenced variables must be registered even if they don't yet have a value.
      // Some variables values are not known until runtime, others at compile time,
      // and others are predefined.
      throw new Error(util.format("the following variable is referenced but never defined: %s",name));
   }
   val = val.value;
   if ((val === undefined) || (val === null)) {
      // This value is defined but does not yet have a value.  This is OK.
      return val;
   }
   if (isInteger(val) || isBoolean(val)) {
      return val;
   } else if (isString(val)) {
      var matches = getMatches(val);
      for (var i = 0; i < matches.length; i++) {
         var varStr = matches[i];
         var varName = normalizeVar(varStr);
         var varVal = getVarValue(varName,vars);
         if (varVal) val = val.replace(varStr,varVal);
      }
      return val;
   } else if (isArray(val)) {
      var list = [];
      val.forEach(function(ele) {
         var eleVal = getVarValue(ele,vars) || ele;
         if (isArray(eleVal)) {
            eleVal.forEach(function(ele2) {
               list.push(ele2);
            });
         } else {
            list.push(eleVal);
         }
      });
      return list;
   } else if (isObject(val) && val.base64Encode) {
      var toEncode = getVarValueStr(val.base64Encode,vars);
      if (getVarNames(toEncode).length > 0) {
         return val;
      }
      return base64Encode(toEncode);
   } else {
      throw Error(util.format("unsupported type for %j",val));
   }
}

function getVarValueStr(str,vars) {
   var matches = getMatches(str);
   for (var i = 0; i < matches.length; i++) {
      var varStr = matches[i];
      var varName = normalizeVar(varStr);
      var varVal = getVarValue(varName,vars);
      if (varVal) str = str.replace(varStr,varVal);
   }
   return str;
}

/*
 * Given an object 'obj', return a new object with the variables in it replaced by the
 * values found in 'vars'.
 */
function getObjectWithVarsReplaced(obj,vars) {
   obj = JSON.stringify(obj);
   for (var name in vars) {
      var val = vars[name];
      if (val) obj = obj.replace('$'+name,val);
   }
   obj = JSON.parse(obj);
   return obj;
}

function checkForJsonResponse(contentType,body) {
   if (!contentType) throw Error("response body did not have a body");
   if (!contentType.startsWith(APP_JSON)) {
      throw Error(util.format("response was of type '%s' but expected '%s'",contentType,APP_JSON));
   }
}

/*
 * Replace $var with {var} syntax when generating swagger doc
 */
function normalizePathForDoc(path) {
   var matches = getMatches(path);
   for (var i = 0; i < matches.length; i++) {
      var varStr = matches[i];
      var varName = normalizeVarForDoc(varStr);
      path = path.replace(varStr,varName);
   }
   return path;
}

function normalizeVarForDoc(str) {
   if (!str || !str.startsWith("$")) {
      return str;
   } else if (str.startsWith("${")) {
      return str.substring(1);
   } else {
      return "{" + str.substring(1) + "}";
   }
}

function getMatches(str) {
   return str.match(/\${(\w*)}|\$(\w*)/g) || [];
}

function normalizeVar(str) {
   if (!str || !str.startsWith("$")) {
      return str;
   } else if (str.startsWith("${")) {
      return str.substring(2,str.length-1);
   } else {
      return str.substring(1);
   }
}

// Determine if an object is a string
function isString(obj) {
   return common.isString(obj);
}

// Determine if an object is a boolean
function isBoolean(obj) {
   return common.isBoolean(obj);
}

// Determine if an object is an integer
function isInteger(obj) {
   return common.isInteger(obj);
}

// Determine if 'obj' is an object (not an array, string, or other type)
function isObject(obj) {
   return common.isObject(obj);
}

function isArray(obj) {
   return common.isArray(obj);
}

function pretty(doc) {
   return common.pretty(doc);
}

// Determine path is a file
function isFile(path) {
   var result = false;
   try {
      result = fs.lstatSync(path).isFile();
   } catch (err) {
   }
   return result;
}

// Determine if path is a directory
function isDir(path) {
   return fs.lstatSync(path).isDirectory();
}

function normalizeVars(vars) {
   var nvars = {};
   for (var name in vars) {
      nvars[name] = {value: vars[name]};
   }
   return nvars;
}

function clone(obj) {
   if (!obj) return null;
   return moduleClone(obj);
}

// Merge obj2 into obj1 and return obj1
// Values in obj1 take precedence over values in obj2 by default
function merge(obj1, obj2, obj2HasPrecedence) {
   for (var key in obj2) {
      if (!obj2.hasOwnProperty(key)) continue;
      if (obj1.hasOwnProperty(key)) {
         var val1 = obj1[key];
         var val2 = obj2[key];
         if (isObject(val1) && isObject(val2)) merge(val1,val2);
         else if (obj2HasPrecedence) obj1[key] = val2;
      } else {
         obj1[key] = obj2[key];
      }
   }
   return obj1;
}

// Convert 'data' to a base 64 encoded string (data may be a Buffer or it may be a string (if string it will be put into a buffer as utf8).
// Uses "Safe URL format so that it can be used in URLs without extra encoding. This is called
// modified Base64 for URL.
function base64Encode(input) {
   return common.base64Encode(input);
}

function forAll(obj,fcn) {
   common.forAll(obj,fcn);
}

function Logger() {
   this.levels = ['error','warn','info','debug','trace'];
   this.setLevel('info');
   this.addTimeStamp = false;
}

Logger.prototype.timeStamp = function () {
  return util.format('[%s]', Date.format("HH:MM:ss:l"));
};

Logger.prototype._log = function(lvl,args) {
   if (this.level < lvl) { return; }
   vals = Array.prototype.slice.call(args);
   var vals = common.values(vals);
   var prefix = this.addTimeStamp ? this.timeStamp() + " " : "";
   var msg = prefix + util.format.apply(null,vals) + "";
   //if (msg === undefined || msg === 'undefined') throw Error("undefined message");
   console.log(msg);
};

Logger.prototype.getLevel = function() {
   return this.levels[this.level];
};

Logger.prototype.setLevel = function(level) {
   if (!level) throw Error("undefined level");
   level = level.toLowerCase();
   for (var i = 0; i < this.levels.length; i++) {
      if (level === this.levels[i]) {
         this.level = i;
         return;
      }
   }
   throw Error(util.format("invalid level: '%s'; must be one of %j",level,this.levels));
};

Logger.prototype.isErrorEnabled = function() {
   return this.level >= 0;
};

Logger.prototype.isWarnEnabled = function() {
   return this.level >= 1;
};

Logger.prototype.isInfoEnabled = function() {
   return this.level >= 2;
};

Logger.prototype.isDebugEnabled = function() {
   return this.level >= 3;
};

Logger.prototype.isTraceEnabled = function() {
   return this.level >= 4;
};

Logger.prototype.error = function() {
   this._log(0, arguments);
};

Logger.prototype.warn = function() {
   this._log(1, arguments);
};

Logger.prototype.info = function() {
   this._log(2, arguments);
};

Logger.prototype.debug = function() {
   this._log(3, arguments);
};

Logger.prototype.trace = function() {
   this._log(4, arguments);
};

Logger.prototype.toString = function() {
   return util.format("log level is %d",this.level);
};

// The main function
function main() {
   log = new Logger();
   var argv = process.argv.slice(2);
   if (argv.length < 1) usage();
   var args = [];
   var inDir, outDir, tests;
   var vars = {};
   // Process options and push non-options onto 'args'
   for (var i = 0; i < argv.length; i++) {
      var arg = argv[i];
      switch(arg) {
      case '-config':
         addConfigToVars(argv[++i],vars);
         break;
      case '-indir':
         inDir = argv[++i];
         if (!isDir(inDir)) usage("'"+inDir+"' is not a directory");
         break;
      case '-outdir':
         outDir = argv[++i];
         if (!isDir(outDir)) usage("'"+outDir+"' is not a directory");
         break;
      case '-log':
         log.setLevel(argv[++i].toLowerCase());
         break;
      case '-var':
         addNameValToVars(argv[++i],vars);
         break;
      case '-tests':
         tests = argv[++i].split(',');
         break;
      case '-v':
         log.setLevel('trace');
         break;
      default:
         if (arg.startsWith('-')) {
            usage("invalid option: "+arg);
         }
         args.push(arg);
         break;
      }
   }
   if (args.length !== 1) usage(util.format("expecting 1 argument but found %d: %j",args.length,args));
   var cmd = args[0].toLowerCase();
   var hapi = new Hapi(vars);
   if (inDir) hapi.setInputDir(inDir);
   if (outDir) hapi.setOutputDir(outDir);
   hapi.loadFromDir();
   var exitCode;
   switch (cmd) {
   case 'gendoc':
      exitCode = hapi.gendoc();
      break;
   case 'compile':
      exitCode = hapi.compile(tests);
      break;
   case 'run':
      if (tests && log.isInfoEnabled()) log.info("Tests to run: %s",tests);
      exitCode = hapi.run(tests);
      break;
   default:
      usage("invalid command: "+cmd);
   }
   return(exitCode);
}

exports.optionNames = ['tests','v', 'log', 'config', 'outdir', 'indir', 'var'];

function usage(msg) {
   if (msg) console.log("ERROR: %s",msg);
   var prog = 'hapi';
   console.log("USAGE: %s gendoc",prog);
   console.log("       %s compile",prog);
   console.log("       %s run",prog);
   console.log("Options:");
   console.log("   -indir <input-dir>         (directory containing input API definitions; default is current working directory)");
   console.log("   -config <config-file>      (config file with variable values");
   console.log("   -log <log-level>           (one of 'error','warn','info','debug','trace')");
   console.log("   -outdir <output-dir>       (directory containing generated doc files; default is current working directory)");
   console.log("   -tests <tests>             (comma-separated list of test names to run; default is to run all tests)");
   console.log("   -var <name>=<value>        (set a variable name and value)");
   console.log("   -v                         (verbose; same as '-log trace')");
   process.exit(1);
}

exports.getArgs = function (options, mccpHome) {
   var args = [];
   var opts = common.clone(options);
   opts.indir = opts.indir || path.join(mccpHome,'hapi');
   opts.outdir = opts.outdir || path.join(mccpHome,'api-docs');
   // fs::existsSync and fs::exists are deprecated in Node, use our homebaked solution
   if (existsSync(path.join(process.env.HOME,'hapi.json'))) {
      args.push('-config');
      args.push(path.join(process.env.HOME,'hapi.json'));
   }

   exports.optionNames.forEach(function (o) {
      if (opts[o]) {
         args.push('-' + o);
         if (o !== 'v') {
            args.push(opts[o]);
         }
      }
   });

   return args;
};

function getArgv(args) {
   var argv = [];
   addArgv(args,argv);
   if (argv.length > 1 && argv[0] === 'node') argv = argv.splice(2);
   return argv;
}

function addArgv(args,argv) {
   forAll(args,function(key,val) {
      if (isString(val)) argv.push(val);
      else addArgv(val,argv);
   });
}

function addConfigToVars(config,vars) {
   var configFiles = config.split(",");
   for (var i = 0; i < configFiles.length; i++) {
      var file = configFiles[i].trim();
      if (!isFile(file)) usage(util.format("file '%s' does not exist",file));
      vars = merge(vars,require(file));
   }
}

function addNameValToVars(nv,vars) {
   var nva = nv.split('=');
   if (nva.length !== 2) usage("invalid format for '-var' option: %s",nv);
   vars[nva[0]] = nva[1];
}

function getFunctionName(fnc) {
   if (!fnc) { return null; }

   // function.name in ES6
   if (fnc.name) { return fnc.name; }

  var ret = fnc.toString();
  ret = ret.substr('function '.length);
  return ret.substr(0, ret.indexOf('('));
}

function strToInt(str) {
   if (isString(str)) return parseInt(str,10);
   return str;
}

var existsSync = common.existsSync;

exports.main = main;
exports.gendoc = main.bind(null,"gendoc");
exports.compile = main.bind(null,"compile");
exports.run = main.bind(null,"run");
