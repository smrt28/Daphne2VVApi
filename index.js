const http = require('http');

const requestListener = function (req, res) {
  let options = {
      host: '192.168.1.162',
      path: req.url,
      port: '80'
  };
  let callback = function(response) {
      var str = ''
      response.on('data', function (chunk) {
          str += chunk;
      });

      response.on('end', function () {
          //let json = JSON.parse(str);
          //str = JSON.stringify(json, null, 4)
          console.log("<<< " + str)

          res.writeHead(200);
          res.end(str);
      });
  };

    console.log(">>> " + req.url)
    http.request(options, callback).end();
  
}

const server = http.createServer(requestListener);
server.listen(80);


