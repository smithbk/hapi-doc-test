var _ = require('lodash');

// Define startsWith method for String object for convenience
if(!String.prototype.startsWith) {
    String.prototype.startsWith = function (str) {
        return _.startsWith(this, str);
    };
}
 
// Define endsWith method for String object for convenience
if(!String.prototype.endsWith) {
   String.prototype.endsWith = function (str) {
      return _.endsWith(this, str);
   };
}

// Define endsWith method for String object for convenience
if(!String.prototype.contains) {
   String.prototype.contains = function (str) {
      return _.includes(this, str);
   };
}

if (!Array.prototype.includes) {
   Array.prototype.includes = function (val) {
      return _.includes(this, val);
   };
}

// true if array intersects with others
if (!Array.prototype.hasAny) {
   Array.prototype.hasAny = function (others) {
      for ( var i = 0; i < this.length; i++ ) {
          if ( others.includes(this[i])) {
             return true;
          }
      }
      return false;
   };
}

// adds ele if not already present
if (!Array.prototype.addUniq) {
   Array.prototype.addUniq = function (val) {
      if (!this.includes(val)) {
         this.push(val);
         return true;
      }
      return false;
   };
}

if (!Array.prototype.addAllUniq) {
   Array.prototype.addAllUniq = function (others) {
      if (others && others.length) {
         for ( var i = 0; i < others.length; i++ ) {
            this.addUniq(others[i]);
        }
      }
      return this;
   };
}

if (!Array.prototype.pull) {
   Array.prototype.pull = function (val) {
      var len = this.length;
      return _.pull(this, val).length !== len;
   };
}

if (!Array.prototype.pullAll) {
   Array.prototype.pullAll = function (others) {
      _.pullAll(this, others);
      
      return this;
   };
}

if (!Array.prototype.dup) {
   Array.prototype.dup = function () {
      return this.slice(0);
   };
}

// See http://blog.stevenlevithan.com/archives/date-time-format for usage
var dateFormat = Date.format = function () {
   var   token = /d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZ]|"[^"]*"|'[^']*'/g,
      timezone = /\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,
      timezoneClip = /[^-+\dA-Z]/g,
      pad = function (val, len) {
         val = String(val);
         len = len || 2;
         while (val.length < len) val = "0" + val;
         return val;
      };

   // Regexes and supporting functions are cached through closure
   return function (date, mask, utc) {
      var dF = dateFormat;

      // You can't provide utc if you skip other args (use the "UTC:" mask prefix)
      if (arguments.length == 1 && Object.prototype.toString.call(date) == "[object String]" && !/\d/.test(date)) {
         mask = date;
         date = undefined;
      }

      // Passing date through Date applies Date.parse, if necessary
      date = date ? new Date(date) : new Date;
      if (isNaN(date)) throw SyntaxError("invalid date");

      mask = String(dF.masks[mask] || mask || dF.masks["default"]);

      // Allow setting the utc argument via the mask
      if (mask.slice(0, 4) == "UTC:") {
         mask = mask.slice(4);
         utc = true;
      }

      var   _ = utc ? "getUTC" : "get",
         d = date[_ + "Date"](),
         D = date[_ + "Day"](),
         m = date[_ + "Month"](),
         y = date[_ + "FullYear"](),
         H = date[_ + "Hours"](),
         M = date[_ + "Minutes"](),
         s = date[_ + "Seconds"](),
         L = date[_ + "Milliseconds"](),
         o = utc ? 0 : date.getTimezoneOffset(),
         flags = {
            d:    d,
            dd:   pad(d),
            ddd:  dF.i18n.dayNames[D],
            dddd: dF.i18n.dayNames[D + 7],
            m:    m + 1,
            mm:   pad(m + 1),
            mmm:  dF.i18n.monthNames[m],
            mmmm: dF.i18n.monthNames[m + 12],
            yy:   String(y).slice(2),
            yyyy: y,
            h:    H % 12 || 12,
            hh:   pad(H % 12 || 12),
            H:    H,
            HH:   pad(H),
            M:    M,
            MM:   pad(M),
            s:    s,
            ss:   pad(s),
            l:    pad(L, 3),
            L:    pad(L > 99 ? Math.round(L / 10) : L),
            t:    H < 12 ? "a"  : "p",
            tt:   H < 12 ? "am" : "pm",
            T:    H < 12 ? "A"  : "P",
            TT:   H < 12 ? "AM" : "PM",
            Z:    utc ? "UTC" : (String(date).match(timezone) || [""]).pop().replace(timezoneClip, ""),
            o:    (o > 0 ? "-" : "+") + pad(Math.floor(Math.abs(o) / 60) * 100 + Math.abs(o) % 60, 4),
            S:    ["th", "st", "nd", "rd"][d % 10 > 3 ? 0 : (d % 100 - d % 10 != 10) * d % 10]
         };

      return mask.replace(token, function ($0) {
         return $0 in flags ? flags[$0] : $0.slice(1, $0.length - 1);
      });
   };
}();

// Some common format strings
dateFormat.masks = {
   "default":      "ddd mmm dd yyyy HH:MM:ss",
   shortDate:      "m/d/yy",
   mediumDate:     "mmm d, yyyy",
   longDate:       "mmmm d, yyyy",
   fullDate:       "dddd, mmmm d, yyyy",
   shortTime:      "h:MM TT",
   mediumTime:     "h:MM:ss TT",
   longTime:       "h:MM:ss TT Z",
   isoDate:        "yyyy-mm-dd",
   isoTime:        "HH:MM:ss",
   isoDateTime:    "yyyy-mm-dd'T'HH:MM:ss",
   isoUtcDateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'"
};

// Internationalization strings
dateFormat.i18n = {
   dayNames: [
      "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
      "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
   ],
   monthNames: [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
   ]
};

// For convenience...
Date.prototype.format = function (mask, utc) {
   return dateFormat(this, mask, utc);
};
