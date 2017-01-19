# HAPI Documentor and Tester User's Manual

*hapi-doc-test* is short for "Http API Documentor and Tester".  This node module is a tool for both generating HTTP API documentation and testing APIs from a single source of input.

Some of the advantages of hapi-doc-test are:

* generates swagger documentation and test cases for APIs from a **single input source**, thus minimizing overall work;

* insures that your documentation stays up-to-date with your code; otherwise, your test cases will fail;

* automatically determines the order in which to call your APIs, which means less work and more complete test coverage.

## Installing hapi-doc-test

To install **hapi-doc-test**, invoke:

```
npm install -g hapi-doc-test
```

# Running hapi-doc-test
USAGE: hapi gendoc
       hapi compile
       hapi run
Options:
   -indir <input-dir>                (directory containing input API definitions; default is current working directory)
   -config <config-file>             (config file with variable values
   -log <log-level>                  (one of 'error','warn','info','debug','trace')
   -outdir <output-dir>              (directory containing generated doc files; default is current working directory)
   -tests <tests>                    (comma-separated list of test name prefixes to run; default is to run all tests)
   -var <name>=<value>               (set a variable name and value)
   -v                                (verbose; same as '-log trace')
```

The three hapi commands are:

* gendoc - to generate swagger documentation for your APIs;

* compile - to compile your APIs into a "test tree" which defines the order in which the tests are to be run, from root down to leaves, but does not run any of the tests;

* run - compiles and runs tests for your APIs.  By default run all tests, or run a single or a subset of the tests with the *tests* option.

## Getting started

This section describes how to start defining input for hapi-doc-test to process.

For example, suppose you want to document and test the following two APIs for **service1**:  
1) GET /foo  
2) POST /bar
 
You can begin by creating the following files.

```
+ <home-directory>
  hapi.json              (user-specific variable values)
    
+ <input-directory>      (directory specified by the 'indir' option)
  hapi.js                ("Defining Variables" section)
  + <service1>           (virtual host directory)
    hapi.js              ("Defining virtual hosts" section)
    get-foo.js           ('GET /foo' API - "Defining APIs" section)
    post-bar.js          ('POST /bar' API - "Defining APIs" section)
```

The **hapi.json** file in your home directory will contain user-specific variable values required to test your APIs.  For now, just create **hapi.json** with contents of `{}`.

Next, create an input directory.  This is the directory that you will specify with the *indir* command line option.  Also create a sub-directory for **service1**.  The directory names can be anything and you can change them later.

The **hapi.js** file in the input directory will contain variable definitions for your APIs, and the **hapi.js** in the **service1** directory will contain the virtual host definition for **service1**.  The following section describes how to create these **hapi.js** files.
  
The **get-foo.js** file defines the *GET /foo* API, and the **post-bar.js** file defines the *POST /bar* API.  These files are described in the **Defining APIs** section below.  
 
> NOTE: If you have a large number of APIs in a virtual host directory, you may create additional sub-directories in order to sub-divide the API files.

### The hapi.js file
The **hapi.js** file may contain one or more of the following:   
1) variable definitions (typically in the top-level **hapi.js**);   
2) virtual host definitions (typically in the virtual host level **hapi.js** files);  
3) functions and/or variables to be shared between multiple APIs (in any **hapi.js** file).  

#### Defining variables

There are three types of variables:  
1) a variable whose value must be provided by the person running hapi (e.g. a user name or password);  
2) a variable whose default value may be provided by the person writing the hapi test case, but can be overridden by the person running hapi (e.g. name of a test application);  
3) a variable whose value is produced by an API (e.g. an application guid).  

Some best practices when defining variables are:  
1) Define and use variables liberally rather than hard-coding values;  
2) Minimize the number of variables whose value must be specified in hapi.json.  You should only specify user-specific variables in this file.  
3) Maximize the number of variable values which may be derived from an API.  For example, if an API requires a guid as input, you should create another API to generate the guid either by looking up an object you know already exists or by creating an object.  In general, a guid or anything that varies from one environment to another should be derived from an API in order to make your tests portable from one environment to another without change.

The following is a sample top-level **hapi.js** file.  

```
"use strict";
module.exports = {
   hapi: {
      variables: {
         userName: { description: 'The user name' },
         userPass: { description: 'The user password' },
         base64UserPass: { description: "Base 64 encoded user name and password", value: { base64Encode: '$userName:$userPass' } },
         appName: { description: 'The application name', value: 'my-test-app' },
         appGuid: { description: 'The application guid' }
      }
   }
};
``` 
Note that all variables MUST have a description.  This description is used when generating documentation.  

With regard to variable values:  
* The value of the *userName* and *userPass* variables should be specified in hapi.json because they are user-specific.  
* The *base64UserPass* variable's value is derived from the value of *userName* and *userPass* by base 64 encoding the values.  This variable may be used in a basic authorization header for an API request.  
* The *appName* variable's value is a constant which identifies the name of the application used by the API's to test.  
* The *appGuid* variable's value will be produced by an API. 

#### Defining virtual hosts

The following is a sample virtual host level **hapi.js** file.  This is the **hapi.js** file in the **service1** directory of the previous section.

```
"use strict";

var hapi = require(__dirname+'/../hapi.js');

module.exports = {

   // The hapi section
   hapi: {
   
      // The virtual host section
      virtual_host: {
      
         // The variable name whose value is used for host name.
         // The value of this variable is user-specific; that is,
         // it is provided by the person invoking hapi.
         host_variable: "service1",

         // Swagger header for service1's doc.
         // This is typical swagger header stuff.
         swagger: {
            swagger: "2.0",
            info: {
               version: "1.0.0",
               title: "Service 1 API",
               description: "Service 1 is a sample service"
            },
            schemes: [ "https", "http" ],
            consumes: [ "application/json" ],
            produces: [ "application/json" ],
            // You will want to customize the tags so that they appear
            // as you want when viewing the swagger documentation.
            tags: [
               { name: "Category1", description: "Category 1 APIs" },
               { name: "Category2", description: "Category 2 APIs" },
               { name: "General", description: "General APIs" },
            ]
         }
      }
   },

   // You may define functions or variables here to be shared among
   // multiple APIs.  For example, the following function defines
   // the schema for the body of an error response which may be returned
   // by multiple APIs.  The schema for the body is described in the
   // following section.
   
   getErrorBody: function () {
      return {
         "error": "error name",
         "error_description": "error description",
         "statusCode": "(i)http status code",
         "operation": "http verb and URI of the operation"
      };
   }
};
```

## Defining APIs

This section describes how to define an API in hapi.

Hapi reads multiple input files from the *input directory* and it's sub-directories.  By default, the input directory is the current directory, or you can specify a different directory with the *indir* option.

The input directory must contain a file named **hapi.js**.  Any sub-directories may also optionally contain additional **hapi.js** files.  All other files ending in **.js** in the input directory or it's sub-directories define a single API.

An API file specifies the format of a request to call the API, as well as all possible responses which may be returned by this API call.  As is often the case, the best way to learn how to write an API file is by example.  Therefore, the following is a sample input API file named **post-bar.js** which defines the *POST /bar* API. 


```
"use strict";

// The hapi module can optionally be used to share variables and/or functions
// between multiple API files
var hapi = require(__dirname+'hapi');

module.exports = {

  // The 'description' field is used by swagger as the summary of the API
  description: "Updates bar",

  // By default, all APIs are documented; however, if you want to exclude an API from the generated documentation,
  // simply set 'private' to 'true'.
  private: false,

  // The 'tags' field is used by swagger to group APIs into categories.
  // This API is in the 'General' category.
  tags: ['General'],

  // The 'request' section is required and used by gendoc, compile, and run.
  // It defines the format of the API's request.
  // It's contents can be any fields recognized by the node.js 'request' module
  // (e.g. method, path, auth, headers, etc).
  // The "$parm1" and "$barName" are examples of an input variables for an API.
  // The "${parm1}" and "${barName}" syntax is also supported if needed.
  // All variables must be defined in a hapi.js file as described later. 
  request: {
     method: 'POST',
     path: "/bar?parm1=$parm1",
     body: {
        name: "$barName"
     }
  },

  // The 'responses' section should contain an entry for each valid status code which
  // can be returned by the API call, including error status codes.
  // If hapi receives a response code that is not defined, a test
  // case failure occurs and the body of the request and response
  // are logged by default.
  responses: {
  
     // A 200 response can be returned by this API
     200: {
     
        // The optional name of this API.
        // The default name would be "service1/post-bar-200" assuming
        // this file is in the service1 sub-directory
        name: "post-bar-200",
     
        // The 'description' field specifies the meaning of this type of response
        description: "The information was successfully retrieved",

        // The body section defines the schema for a 200 response, along with
        // descriptions of each field for gendoc.  This syntax is simply
        // short-hand for JSON schema, since JSON schema can be pretty verbose.
        // In fact, hapi internally converts this into JSON schema.
        // By default, each field is assumed to be a required string field, 
        // where the value of the field is the field's description.
        // For example, 'name' is a required string field and it's description
        // is "Name of the environment".
        // For non-default fields, the value is of the form:
        //    "(comma-separated-flags)<description>".
        // For example, the 'version' field below is an "integer" field.
        // See the following section entitled 'Response body schema flags' 
        // for a complete list and description of schema flags.
        body: {
           name: "Name of the environment",
           version: "(i)The version of Bluemix",
           authorization_endpoint: "URL of the authorization endpoint",
           token_endpoint: "URL of the token endpoint",
           anObject: {
               anArrayOfStrings: ["description of this string field"],
               anArrayOfIntegers: ["(i)description of this int field"]
           }
        },
        
        // If you want to associate a description or a flag with an object
        // or an array, you will need to specify a 'bodymd' field
        // (short for 'body metadata').
        // The keys of each bodymd element are paths to a field in the body,
        // and the values of each bodymd element is standard JSON schema.
        // For example, the following two elements state that:
        // 1) the 'anObject' field in the response body is optional, and
        // 2) the description of the 'anObject.anArrayOfStrings' field in
        //    the response body is 'An array of names'.  
        bodymd: {
           anObject: {required: false},
           'anObject.anArrayOfStrings': {description: 'An array of names'}
        },
        
        // The optional actions section is used to set variables from the response.
        // Specifying a "$variable" in a request defines the API's INPUT variables.
        // Specifying "var_" actions in a response defines the API's OUTPUT variables.
        // This sample has two output variables when receiving a 200 response:
        // 1) the 'var1' variable is set to the value of the 'field1'
        //    field in the response;
        // 2) the 'var2' variable is set to the value of the 'field2'
        //    field in the response.
        // See the following section entitled "Action values" for
        // a complete list of all variable actions.
        actions: [
           { var_set: { name: 'var1', path: 'field1' } },
           { var_set: { name: 'var2', path: 'field2' } }
        ]
     },
     
     // A 400 response may also be returned from this API
     400: {
     
        // Returns 400 when the parm1 query parameter is invalid
        // The default name would be "service1/post-bar-foo"
        name: "post-bar-invalid-parm1",
        
        // This is a description of when or why this response is returned
        description: "The parm1 value was invalid",
        
        // The 'vars' section specifies the value of the variable(s) to use
        // in the request in order to generate this response.
        // The following indicates that sending a "POST /var?parm1=bogusParm1Value" 
        // request will generate a 400 response.
        vars: {parm1: 'bogusParm1Value'},
        
        // Sometimes using the 'vars' field may not be sufficiently expressive,
        // so instead of using 'vars', you could also do the following.
        // Note that the fields of this request are merged into the
        // top level request to generate the request which is actually sent
        // to generate the 400 response.
        request: {
           path: "/bar?parm1= bogusParm1Value"
        },
        
        // The 'body' defines the schema for a 400 response error.
        // We call a function defined in hapi to get this value so that it
        // can be shared by other APIs.
        body: hapi.getErrorBody(400)
     }
  }
};
```
>NOTE: An API file can also be standard JSON; however, all samples will be node.js modules in order to allow imports, comments, and other node.js features to be used.

### Response body schema flags          
As shown in the previous sample, the schema of a response body may contain *comma-separated-flags*.  
The following are the supported flags:  
> **a**: an array field;  
**b**: a boolean field;   
**ba**: an array of booleans field;  
**dt**: a date-time field;
**dts**: a date-time formatted string field;  
**i**: an integer field;  
**ia**: an array of integers field;  
**ign**: a field ignored by hapi;  
**o**: an object field;   
**opt**: an optional field;   
**s**: a string field;  
**sa**: an array of strings field;   
**req**: a required field.

### Variable actions          
The previous sample demonstrated the **var_set** action to set a variable value based on a value from an API response.  This section describes all of the variable actions supported by hapi: **var_set**, **var_new**, **var_delete**, and **var_rename**.

#### 1) var_set

Use a **var_set** action for an API which retrieves the value of an existing object.  The generic format of a var_set is as follows:

```
var_set: {
   name: '<variable-name>',
   path: '<path-to-body-element>'
}
```
  
For example, consider an API to retrieve an app guid given an app name.  The following var_set sets the **appGuid** variable to the value found in **metadata.guid** field in the response body.

```
var_set: {
   name: 'appGuid',
   path: 'metadata.guid'
}
```

#### 2) var_new

Use a **var_new** when the API creates a new object.  The following is the generic format of a var_new.

```
var_new: {
   name: '<variable-name>',
   path: '<path-to-body-element>',
   get: '<name-of-API-to-retrieve-object>',
   delete: <name-of-API-to-delete-object>'
}
```

Note that the **var_new** is the same as the **var_set** except with two additional required fields:   
1) the **get** field is the name of the corresponding API to retrieve the value of an existing object, and   
2) the **delete** field is the name of the corresponding API to delete the object.

Or to use object-oriented terminology,  
* the API containing the **var_new** is the object *constructor*,  
* the **get** API is the object *getter*, and  
* the **delete** API is the object *destructor*.
 
For example, consider an API to create an application.  The following **var_new** refers to the **get-app-200** API as the *getter* and the **delete-app-204** API as the *destructor*.

```
var_set: {
   name: 'appGuid',
   path: 'metadata.guid'
   get: 'service1/get-app-200',
   delete: 'service1/delete-app-204'
}
```
As discussed earlier, the default name of an API generated by hapi is of the form *pathToFileWithOutJsSuffix*-*responseCode*.  For example, **service1/get-app** is the *pathToFileWithOutJsSuffix* and **200** is the *responseCode*.

As noted earlier, the default API names may be overridden. 

#### 3) var_delete

Use a **var_delete** when the API deletes something.  The generic format of a **var_delete** is as follows:

```
var_delete: {
   name: '<variable-name>'
}  

```

For example, an API which deletes an application contains the following, which means that hapi deletes the *appGuid* variable upon receiving a successful response from this API.

```
var_delete: {
   name: 'appGuid'
} 
```

#### 4) var_rename

Use a **var_rename** when you want to rename a variable.  The generic format of a **var_rename** is as follows:

```
var_rename: {
   from: '<old-variable-name>',
   to: '<new-variable-name>'
}  

```

For example, if you want to write a test which uses the guid of an application that has been deleted, instead of using **var_delete**, you would use **var_rename** as follows.  Another test could then use the **deletedAppGuid** variable as input.

```
var_rename: {
   from: 'appGuid',
   to: 'deletedAppGuid'
} 
```

## Hooks

**hapi-doc-test** provides hooks for inserting custom actions before and after tests are run. You may override them by adding methods with the same name to your **hapi-doc-test** export object.

#### onBeforeRun and onAfterRun

`onBeforeRun` is executed after **hapi-doc-test** runs its pre-test logic, but before the actual test run.

`onAfterRun` is executed after **hapi-doc-test** runs its test logic, but before **hapi-doc-test** finalizes the test.

Both methods receive a context object that contains key-value pairs of test variables reflecting the current runtime state. You may use this context to make data available later within the same test run.

```js
// TestContext interface
getVar (name: String) : Any
setVar (name: String, val: Any) : void

// Delegate signature
ErrorHandler (err: Error) : void

// Hooks
onBeforeRun (vars: TestContext, cb: ErrorHandler) : void
onAfterRun (vars: TestContext, cb: ErrorHandler) : void
```

Example:
```
module.exports = {
   tags: ["MyApi"],
   description: "Super amazing API.",
   onBeforeRun: function (ctx, cb) {
      // make a custom request to get some prerequisite data
      getSpecial(function (err, data)) {
         if (!err) {
            ctx.setVar('bar', data.field);
         }
         cb(err);
      }
   },
   request: {
      method: "GET",
      path: "/wu/tang?q=foo:$bar"  // `bar` will reflect the value set above
   },
   // ...
};

```

## Implicit dependencies

There may be times when you need to tell **hapi-doc-test** that a test has an a variable dependency that isn't obvious. You can indicate these dependencies using the `implicit` field. 

Example:
```
module.exports = {
   tags: ["MyApi"],
   description: "Super amazing API.",
   onBeforeRun: function (ctx, cb) {
      // make a custom request to get some prerequisite data
      getSpecial(function (err, data)) {
         if (!err) {
		 
            var bar = ctx.getVar('bar');
			// do something with bar
         }
         cb(err);
      }
   },
   // make sure `bar` is set before this module is executed
   implicit:['bar']
   // ...
};

```

## Ignoring Files

You may list files for **hapi-doc-test** to ignore by placing a `.hdtignore` file in your test root directory. `.hdtignore` supports globs, much like `.gitignore`. You can read more about glob syntax [here](https://www.npmjs.com/package/glob).

```
utils/*
**/*-skip.js
```

## Additional tips

As you have noticed by now, input and output variables are central to hapi.  It uses them to build a dependency tree during the compilation step.  It is therefore recommended that you write APIs in top-down order.  For example, if you want to write an API which requires an *appGuid* input variable, you should first write an API to look up and/or create an application.  This API will provide the *appGuid* as output.

If you want to see the dependency tree built by hapi, simply run the
`node hapi compile` command.

You will also notice that you'll spend a good bit of time writing the response body schema.  To make this go more quickly, you can simply define an empty response with an empty body and invoke `node hapi run -test <test-prefix-name>`.  The test will fail but the body of the response will be logged.  You can then cut-n-paste the response and edit it to create a response schema.  This will make the process go more quickly.

## Future enhancement ideas

1) Enhance hapi to also perform load testing.

2) Create a GUI which takes recorded HTTP traffic as input and provides an option to create an API entry for each distinct request/response code pair.  The GUI would make developing input files easier.  It could also keep track of which APIs are not documented, run the test cases, etc.  The "service proxy" capability of CF could be leveraged to wrapper this in a service.

3) Handle pagination.

## Contact

For problems or comments, contact Keith Smith at bksmith@us.ibm.com

