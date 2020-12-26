const Gpio = require('onoff').Gpio;
const led = new Gpio(17, 'out');
const { Pool } = require('pg')
const fs = require('fs')


if (! fs.existsSync('./config/default.json5')) {
    console.error('config/default.json5 must exist. Look at config/example.json5')
    process.exit()
}

const config = require('config')

if (! (config.has('postgresConfiguration') && config.get('postgresConfiguration').host.length > 0)) {
    console.log('You must define locationid and Postgres configuration in the config file')
    process.exit()
}

if (config.has('locationid') && config.get('locationid').length ) {
  global.locationid = config.get('locationid')
  }
else {
  global.locationid = 0
  }

const inputPinRef = new Gpio(config.get('inputPin'), 'in', 'rising');
const debuglogging = config.get('debuglogging')

function connectToDB(retryOnFailure = true) {
    postgressConfiguration = config.get('postgresConfiguration')

    pool = new Pool( postgressConfiguration )
    
    pool.on('error', function(error) {
        console.log('Lost connection to database: ' + error)
        console.log('Will wait and try to reconnrect')
        setTimeout(connectToDB,5000)
    })
    
    // test our connection
    ;(async function() {
        const client = await pool.connect()
        .then( result => {
            console.log(`Connection to Postgres successful!`)
	    result.on('error', (error) => {
	        console.log(`error on the client: ${error}`)
	    })
            result.release()
        } )
        .catch( e=> {
	    if (retryOnFailure) {
		console.log(`Error connecting to Postgres! ${e}`)
		console.log(`Will wait and retry`)
            setTimeout(connectToDB,5000)
	    }
	    else {
	        console.error(`Error connecting to Postgres! ${e}. Will exit. `)
		    process.exit()}
	    })
    })()
}

// passing retryOnFailure = false for the first time we connect
connectToDB(false)

var counter = 0

inputPinRef.watch((err, value) => {
  if (err) {
    throw err;
  }

  led.writeSync(value);
  counter++
});

process.on('SIGINT', _ => {
  led.unexport();
  inputPinRef.unexport();
});

setInterval(function() {
    var timestamp = new Date()

    if (typeof lastcounter == 'undefined') { lastcounter = '' }
    console.log(`lastcounter: ${lastcounter}, counter:${counter}`)
    lastcounter = counter

    console.log(counter);
    // only send data if it's greater than 0. But always finish a dataset with a zero so we have a clean chart
    // We also make sure the counter is at least 2 to ignore noise / false signals
    if (counter > 0 && lastcounter > 0 ) {
      sendData({"flow_rate":counter,"timestamp":timestamp})
    }
    counter = 0
    
}, 1000);


async function sendData(dataset) {
    const query = `
    INSERT INTO waterflow (timestamp, locationid, flow_rate)
    VALUES ($1, $2, $3);
    `
    await pool.query(query,[dataset.timestamp, global.locationid, dataset.flow_rate])
    .then( ()=> {
        if (debuglogging) console.log(`${dataset.flow_rate} for ${dataset.timestamp} has been sent.`)
        //else process.stdout.write(dataset.busvolts + ", " + dataset.current + "\r")
    })
    .catch( (error) => {
        console.log(`Error during SQL execution, will exit. Error: ${error}`)
        process.exit()
    })
}
