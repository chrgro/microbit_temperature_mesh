//  DEVICE ID
//  CHANGE FOR EVERY NEW DEVICE!
let DEVICE_ID = 19
//  Encryption key, must be 19 bytes
let key = pins.createBufferFromArray([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
let AHTX0_I2CADDR = 0x38
//  AHT default i2c address
let AHTX0_CMD_CALIBRATE = 0xE1
//  Calibration command
let AHTX0_CMD_SOFTRESET = 0xBA
//  Soft reset command
let AHTX0_CMD_TRIGGER = 0xAC
let AHTX0_STATUS_BUSY = 0x80
//  Status bit for busy
let AHTX0_STATUS_CALIBRATED = 0x08
//  Status bit for calibrated
let AHTX0_READ_ATTEMPTS = 5
let AHTX0_CALIBRATION_SUCCESS_TEMP = -50
let AHTX0_CALIBRATION_FAILED_TEMP = -49
function ahtx0_get_status(): number {
    return pins.i2cReadNumber(AHTX0_I2CADDR, NumberFormat.UInt8LE, false)
}

function ahtx0_init(): boolean {
    basic.showIcon(IconNames.Surprised)
    serial.writeLine("# AHT sensor reset and calibration...")
    //  Reset AHT
    pins.i2cWriteNumber(AHTX0_I2CADDR, AHTX0_CMD_SOFTRESET, NumberFormat.Int8LE, false)
    control.waitMicros(20000)
    let cmd = Buffer.create(3)
    cmd.setUint8(0, AHTX0_CMD_CALIBRATE)
    cmd.setUint8(1, 0x08)
    cmd.setUint8(2, 0x00)
    pins.i2cWriteBuffer(AHTX0_I2CADDR, cmd, false)
    while (ahtx0_get_status() & AHTX0_STATUS_BUSY) {
        serial.writeLine("# AHT sensor busy, waiting...")
        control.waitMicros(10000)
    }
    control.waitMicros(10000)
    if (ahtx0_get_status() & AHTX0_STATUS_CALIBRATED) {
        serial.writeLine("# AHT sensor calibrated")
        basic.showIcon(IconNames.Happy)
    } else {
        serial.writeLine("# AHT sensor NOT calibrated!!")
        basic.showIcon(IconNames.Sad)
        
        aht_init_failed_count += 1
        if (aht_init_failed_count >= 10) {
            serial.writeLine("# Failed AHT init 10 times, resetting microbit")
            send_message("e", 4)
            basic.pause(1000)
            control.reset()
        }
        
        return false
    }
    
    aht_init_failed_count = 0
    return true
    basic.pause(1000)
}

function ahtx0_get_data(): number[] {
    let init_success: boolean;
    let cmd = Buffer.create(3)
    cmd.setNumber(NumberFormat.UInt8LE, 0, AHTX0_CMD_TRIGGER)
    cmd.setNumber(NumberFormat.UInt8LE, 1, 0x33)
    cmd.setNumber(NumberFormat.UInt8LE, 2, 0x00)
    pins.i2cWriteBuffer(AHTX0_I2CADDR, cmd)
    control.waitMicros(90000)
    for (let attempt = 0; attempt < AHTX0_READ_ATTEMPTS; attempt++) {
        if (ahtx0_get_status() & AHTX0_STATUS_BUSY) {
            control.waitMicros(20000)
            serial.writeLine("# Sensor should not take so long time... attempt " + ("" + attempt) + " of " + ("" + AHTX0_READ_ATTEMPTS))
        } else {
            break
        }
        
    }
    let readbuf = pins.i2cReadBuffer(AHTX0_I2CADDR, 6, false)
    let h = readbuf.getNumber(NumberFormat.UInt8LE, 1)
    h <<= 8
    h |= readbuf.getNumber(NumberFormat.UInt8LE, 2)
    h <<= 4
    h |= readbuf.getNumber(NumberFormat.UInt8LE, 3) >> 4
    let humidity = h * 100.0 / 0x100000
    serial.writeString("# Measured Humidity: ")
    serial.writeNumber(humidity)
    let t = readbuf.getNumber(NumberFormat.UInt8LE, 3) & 0x0F
    t <<= 8
    t |= readbuf.getNumber(NumberFormat.UInt8LE, 4)
    t <<= 8
    t |= readbuf.getNumber(NumberFormat.UInt8LE, 5)
    let temperature = t / 0x100000 * 200.0 - 50
    serial.writeString(" Temperature: ")
    serial.writeNumber(temperature)
    serial.writeLine("")
    //  Temperature read from i2c can't be 0, let's re-init if we ever see 0
    if (t == 0) {
        init_success = ahtx0_init()
        //  Report the sucess or failure of 
        if (init_success) {
            return [AHTX0_CALIBRATION_SUCCESS_TEMP, -1]
        } else {
            return [AHTX0_CALIBRATION_FAILED_TEMP, -1]
        }
        
    }
    
    return [temperature, humidity]
}

//  Function to retrieve the temperature
//  In the future, expand this to read from an external set_transmit_power
//  instead of the internal microbit sensor
function read_temp_humidity(): number[] {
    let raw_value: number;
    let temp: number;
    let i2c_aht_temp = true
    let i2c_temp = false
    if (i2c_aht_temp) {
        let [temperature, humidity] = ahtx0_get_data()
        return [temperature, humidity]
    } else if (i2c_temp) {
        raw_value = pins.i2cReadNumber(0x48, NumberFormat.Int16BE, false)
        //  Reduce to just 2 subfractional bits (i.e. 0.25 C resolution)
        // truncated_value = raw_value & 0xffC0
        temp = raw_value * 0.00390625
        //  divide by 256
        return [temp, -1]
    } else {
        return [input.temperature(), -1]
    }
    
}

//  Encryption is a simple XOR, with keysize equal to datasize,
//  19 bytes. This is equally safe as any other block cipher.
//  The block mode is CBC, with an 8 bit block size and thus
//  8 bit initialization vector (IV). It at least reduces the odds
//  of repeat messages, but there will be some of them (every 256th
//  message with the same plaintext will then have same ciphertext).
//  We could use a bigger block size, the code just gets a tiny bit
//  more complicated and we lose plaintext capacity.
function encrypt_message(message: Buffer): Buffer {
    let char: number;
    let ciphertext = control.createBuffer(19)
    let iv = randint(0, 255)
    let mod_v = iv
    for (let i = 0; i < ciphertext.length; i++) {
        //  Pad message with a slot of IV, and enough spaces
        //  on the end to always make it at least 19 bytes.
        if (i == 0 || i - 1 >= message.length) {
            char = 0
        } else {
            char = message[i - 1]
        }
        
        ciphertext[i] = char ^ mod_v ^ key[i]
        mod_v = ciphertext[i]
    }
    return ciphertext
}

function decrypt_message(message: Buffer): Buffer {
    let decrypted: number;
    //  19 bytes for the buffer
    let padded_plain_buffers = control.createBuffer(19)
    let mod_v = message[0]
    for (let i = 0; i < key.length; i++) {
        decrypted = message[i] ^ mod_v ^ key[i]
        padded_plain_buffers[i] = decrypted
        mod_v = message[i]
    }
    return padded_plain_buffers.slice(1)
}

//  Wrapper function to send messages out on BLE
function send_message(datatype: string, value: number) {
    if ([0, 1].indexOf(verbosity_level) >= 0) {
        basic.showIcon(IconNames.Duck)
    }
    
    //  Pack the data
    let message_to_send = control.createBuffer(18)
    message_to_send.fill(0)
    message_to_send[0] = DEVICE_ID
    message_to_send[1] = datatype.charCodeAt(0)
    message_to_send.setNumber(NumberFormat.Float32LE, 2, value)
    radio.sendBuffer(encrypt_message(message_to_send))
    //  Encrypted
    serial.writeLine(buffer_to_json(message_to_send, "sent"))
    basic.clearScreen()
}

//  For an incoming message with id and type, check if we have reject_seen_recently
//  seen a message like it, and update the list as needed
//  Return 0 if we should not forward this message, 1 if we should forward.
function check_last_message_time(received_device_id: number, received_value_type: string): number {
    let prev_seen_message: Buffer;
    let message_received_time: number;
    let running_time: number;
    let time_since_message: number;
    
    serial.writeLine("# Checking for last recieved time (limit " + ("" + TX_FLOOD_CONTROL_MS) + ") for device_id " + ("" + received_device_id) + " and type " + received_value_type)
    for (let i = 0; i < received_messages.length; i++) {
        prev_seen_message = received_messages[i]
        if (get_message_device_id(prev_seen_message) == received_device_id && get_message_value_type(prev_seen_message) == received_value_type) {
            message_received_time = get_message_received_time(prev_seen_message)
            running_time = input.runningTime()
            time_since_message = running_time - message_received_time
            if (0 < time_since_message && time_since_message < TX_FLOOD_CONTROL_MS) {
                serial.writeLine("# Very recent match, current time was " + ("" + running_time) + " and time since msg " + ("" + time_since_message))
                return 0
            } else {
                serial.writeLine("# Only an old match, removing it and forwarding")
                received_messages.removeAt(i)
                return 1
            }
            
        }
        
    }
    serial.writeLine("# Found no previous match of this id+type")
    return 1
}

//  Filter bad messages
function is_message_bad(receivedBuffer: Buffer): boolean {
    //  Reject any non-ASCII messages
    let datatype = get_message_value_type(receivedBuffer)
    let charcode = datatype.charCodeAt(0)
    //  Check for valid ascii in buffer type field and last byte equals to 0
    if (!(32 <= charcode && charcode <= 126) || receivedBuffer[17] != 0) {
        serial.writeLine("# Error, rejecting message due to likely decrypt failure, charcode: " + ("" + charcode))
        return true
    }
    
    //  Reject messages of type different a small group
    if (["t", "h", "c", "v", "n", "a", "b", "d", "e"].indexOf(get_message_value_type(receivedBuffer)) < 0) {
        serial.writeLine("# Error, rejecting message not having an expected type :" + get_message_value_type(receivedBuffer))
        return true
    }
    
    //  Reject messages that hit the throw condition, i.e. its not a valid number
    if (get_message_value(receivedBuffer) == FAILURE_VALUE) {
        serial.writeLine("# Error, rejecting message not having a valid floating point ")
        return true
    }
    
    return false
}

//  Append own device ID to forwarded message
function append_forwarded_device_id(messageBuffer: Buffer) {
    //  Loop all bytes to look for the first free location
    for (let i = 6; i < 17; i++) {
        if (messageBuffer[i] == 0) {
            messageBuffer[i] = DEVICE_ID
            return
        }
        
    }
    //  If there are no free slots, just keep the buffer unchanged
    return
}

//  Callback function on recieved wireless data
function decode_buffer(receivedBuffer: Buffer) {
    let received_message_device_id: number;
    let received_message_value_type: string;
    let last_seen: Buffer;
    
    if ([0, 1].indexOf(verbosity_level) >= 0) {
        basic.showIcon(IconNames.SmallDiamond)
    }
    
    // # DEBUG PRINT
    // serial.write_string("# Decoding buffer:\n# ")
    // for i in range(receivedBuffer.length):
    //     serial.write_string(str(receivedBuffer[i]) + " ")
    // serial.write_line("")
    if (is_message_bad(receivedBuffer)) {
        
    } else {
        //  Extract device ID and value type from the incoming data
        received_message_device_id = get_message_device_id(receivedBuffer)
        received_message_value_type = get_message_value_type(receivedBuffer)
        //  Check if its our own data coming back to us
        if (DEVICE_ID != received_message_device_id) {
            //  Check whether we've recently seen this data
            if (check_last_message_time(received_message_device_id, received_message_value_type) == 1) {
                last_seen = control.createBuffer(6)
                last_seen.setNumber(NumberFormat.Int8LE, 0, received_message_device_id)
                last_seen[1] = received_message_value_type.charCodeAt(0)
                last_seen.setNumber(NumberFormat.Float32LE, 2, input.runningTime())
                received_messages.push(last_seen)
                //  Tiny random pause before forwarding, to reduce collision odds
                basic.pause(randint(0, 100))
                //  Append my own device ID to the message
                append_forwarded_device_id(receivedBuffer)
                //  Send off the message again
                radio.sendBuffer(encrypt_message(receivedBuffer))
                //  Encrypted
                serial.writeLine(buffer_to_json(receivedBuffer, "forward"))
                if ([0, 1].indexOf(verbosity_level) >= 0) {
                    basic.showIcon(IconNames.Yes)
                }
                
            } else {
                serial.writeLine(buffer_to_json(receivedBuffer, "reject_seen_recently"))
                if ([0, 1].indexOf(verbosity_level) >= 0) {
                    basic.showIcon(IconNames.No)
                }
                
            }
            
        } else {
            serial.writeLine(buffer_to_json(receivedBuffer, "reject_own_id"))
            if ([0, 1].indexOf(verbosity_level) >= 0) {
                basic.showIcon(IconNames.No)
            }
            
        }
        
    }
    
    basic.clearScreen()
}

//  Buffer layout:
//  Byte 0: device id
//  Byte 1: Data type
//  Byte 2-5: value
//  Byte 6-16: device id of forwarding nodes
//  Byte 17: Either 0 or ascii > if we ran out of space
function buffer_to_json(buf: Buffer, action: string): string {
    let forwarded_device_id: number;
    let buffer_device_id = get_message_device_id(buf)
    let buffer_type = get_message_value_type(buf)
    let buffer_value = buf.getNumber(NumberFormat.Float32LE, 2)
    let buffer_sent_via = "[ "
    for (let i = 6; i < 18; i++) {
        if (buf[i] == 0) {
            break
        }
        
        forwarded_device_id = buf.getNumber(NumberFormat.Int8LE, i)
        buffer_sent_via += "" + forwarded_device_id + ","
    }
    buffer_sent_via = buffer_sent_via.slice(0, -1) + "]"
    let retstr = "{\"device_id\":" + ("" + buffer_device_id) + ","
    retstr += "\"type\": \"" + ("" + buffer_type) + "\","
    retstr += "\"value\": " + ("" + buffer_value) + ","
    retstr += "\"forwarded_via\":" + buffer_sent_via + ","
    retstr += "\"action_taken\": \"" + action + "\""
    retstr += "}"
    return retstr
}

radio.onReceivedBuffer(function on_received_buffer(receivedBuffer: Buffer) {
    let decrypted_msg = decrypt_message(receivedBuffer)
    decode_buffer(decrypted_msg)
})
//  Encrypted
//  Split out the type from <id>:<type>:<value>
function get_message_value_type(message: Buffer): string {
    let single_byte: Buffer;
    let type_str: string;
    try {
        single_byte = control.createBuffer(1)
        single_byte[0] = message[1]
        type_str = single_byte.toString()
        return type_str
    }
    catch (_) {
        //  This is after validation of message types, should
        //  in theory this should be unreachable
        return "bad_type"
    }
    
}

//  From a message buffer, extract the
//  device id
//  Return ID 0 on any errors
//  Accept only IDs between 1 and 99
function get_message_device_id(message: Buffer): number {
    let t: number;
    try {
        t = message.getNumber(NumberFormat.Int8LE, 0)
        if (!(0 < t && t < 100)) {
            return 0
        }
        
        return t
    }
    catch (_) {
        return 0
    }
    
}

//  Split out the value from <id>:<type>:<value>
function get_message_value(message: Buffer): number {
    let v: number;
    try {
        v = message.getNumber(NumberFormat.Float32LE, 2)
        return v
    }
    catch (_) {
        return FAILURE_VALUE
    }
    
}

//  Split out the recieved time from the buffer
function get_message_received_time(prev_seen_message: Buffer): number {
    return prev_seen_message.getNumber(NumberFormat.Float32LE, 2)
}

//  Initial setup and ID print
let FAILURE_VALUE = -999
let verbosity_level = 0
let aht_init_failed_count = 0
let received_messages : Buffer[] = []
led.setBrightness(128)
radio.setGroup(181)
radio.setTransmitPower(7)
serial.writeLine("# Powered on, with ID: " + ("" + DEVICE_ID))
ahtx0_init()
let TX_INTERVAL_MS = 10 * 60 * 1000
let TX_FLOOD_CONTROL_MS = Math.trunc(TX_INTERVAL_MS * 0.9)
basic.showString("ID " + ("" + DEVICE_ID))
basic.showIcon(IconNames.SmallSquare)
basic.clearScreen()
let temp = AHTX0_CALIBRATION_FAILED_TEMP
let humidity = -2
//  Keep measuring and printing the current temp/humidity
basic.forever(function on_forever_show_screen() {
    
    
    let [t, h] = read_temp_humidity()
    temp = t
    humidity = h
    if ([0, 2].indexOf(verbosity_level) >= 0) {
        basic.showString("" + Math.roundWithPrecision(temp, 1) + "C")
        if (humidity >= 0) {
            basic.pause(500)
            basic.showString("" + (Math.round(humidity) + "%"))
        }
        
    }
    
    basic.pause(8000)
})
//  Keep sending out the temperature/humidity
basic.forever(function on_forever_send() {
    basic.pause(TX_INTERVAL_MS / 2)
    if (temp == AHTX0_CALIBRATION_SUCCESS_TEMP) {
        serial.writeLine("# Successfull AHT runtime calibration")
        send_message("e", 1)
    } else if (temp == AHTX0_CALIBRATION_FAILED_TEMP) {
        serial.writeLine("# Failed AHT runtime calibration")
        send_message("e", 2)
    } else {
        send_message("t", temp)
    }
    
    basic.pause(TX_INTERVAL_MS / 2)
    if (humidity >= 0) {
        send_message("h", humidity)
    }
    
})
//  On press button A, force a value send
input.onButtonPressed(Button.A, function on_button_pressed_a() {
    if (temp < 0) {
        serial.writeLine("# Error 3: Bad temp " + ("" + temp))
        send_message("e", 3)
    } else {
        send_message("t", temp)
    }
    
    if (humidity >= 0) {
        send_message("h", humidity)
    }
    
})
//  On press button B, change how much is shown on screen
input.onButtonPressed(Button.B, function on_button_pressed_b() {
    //  0: Show everything (current temp + radio events)
    //  1: Only show radio events, don't show current temp
    //  2: Only show current temp, don't show radio events
    //  3: Keep the screen clear
    
    verbosity_level = (verbosity_level + 1) % 4
    if (verbosity_level == 0) {
        basic.showString("SHOW ALL")
    } else if (verbosity_level == 1) {
        basic.showString("RADIO ONLY")
    } else if (verbosity_level == 2) {
        basic.showString("TEMP ONLY")
    } else if (verbosity_level == 3) {
        basic.showString("QUIET")
    }
    
})
