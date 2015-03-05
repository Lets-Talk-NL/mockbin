'use strict';

var dicer = require('dicer');
var qs = require('qs');
var typer = require('media-typer');
var util = require('../utils');

module.exports = function (req, res, next) {
  req.bodyChunks = [];

  req.on('data', function (chunk) {
    req.bodyChunks.push(chunk);
  });

  req.on('end', function () {
    req.rawBody = Buffer.concat(req.bodyChunks);
    req.body = req.rawBody.toString('utf8');
    req.bodySize = req.rawBody.length;
    req.jsonBody = null;
    req.formBody = null;
    req.contentType = null;
    req.multiPartSimple = {};

    // parse Content-Type
    var type = req.headers['content-type'] ? typer.parse(req) : null;

    if (type) {
      req.contentType = [[type.type, type.subtype].join('/'), type.suffix].join('+').replace(/\+$/, '');
    }

    // create HAR Object
    req.har = util.createHar(req);
    req.simple = util.createSimpleHar(req);

    // json
    switch (req.contentType) {
      case 'application/json':
        try {
          req.jsonBody = JSON.parse(req.body);
        } catch (exception) {}

        next();
        break;

      case 'application/x-www-form-urlencoded':
        req.formBody = qs.parse(req.body);

        // update HAR objects
        req.simple.postData.params = req.formBody;
        req.har.log.entries[0].request.postData.params = util.objectToArray(req.formBody);

        next();
        break;

      case 'multipart/form-data':
        var stream = require('stream');
        var liner = new stream.Transform();

        req.multiPartData = [];
        req.multiPartParams = [];

        // parse a file upload
        var dice = new dicer({
          boundary: type.parameters.boundary
        });

        dice.on('part', function (part) {
          part.on('data', function (data) {
            req.multiPartData.push(data.toString('utf8'));
          });

          part.on('header', function (headers) {
            var param = {};

            if (headers['content-disposition']) {
              var disposition = typer.parse(headers['content-disposition'][0].replace('form-data', 'form-data/text'));

              param.name = disposition.parameters.name;

              if (disposition.parameters.filename) {
                param.fileName = disposition.parameters.filename;
              }
            }

            if (headers['content-type']) {
              var type = typer.parse(headers['content-type'][0]);

              param.contentType = [[type.type, type.subtype].join('/'), type.suffix].join('+').replace(/\+$/, '');
            }

            req.multiPartParams.push(param);
          });
        });

        dice.on('finish', function () {
          req.multiPart = req.multiPartParams.map(function (param, index) {
            // append value to pair
            param.value = req.multiPartData[index];

            // createa a new simple object
            req.multiPartSimple[param.name] = param.value;
            return param;
          });

          // update HAR objects
          req.simple.postData.params = req.multiPartSimple ? req.multiPartSimple : [];
          req.har.log.entries[0].request.postData.params = req.multiPart ? req.multiPart : [];

          next();
        });

        liner.pipe(dice);
        liner.push(req.body);
        break;

      default:
        next();
    }
  });
};
