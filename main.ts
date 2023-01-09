//  DEVICE ID
//  CHANGE FOR EVERY NEW DEVICE!
let DEVICE_ID = 4
//  Function to retrieve the temperature
//  In the future, expand this to read from an external set_transmit_power
//  instead of the internal microbit sensor
function read_temp(): number {
    return input.temperature()
}

//  Encryption key, must be 19 bytes
let key = pins.createBufferFromArray([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
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

//  On press button A, force a value send
input.onButtonPressed(Button.A, function on_button_pressed_a() {
    send_message("t", read_temp())
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
//  Wrapper function to send messages out on BLE
function send_message(datatype: string, value: number) {
    if ([0, 1].indexOf(verbosity_level) >= 0) {
        basic.showIcon(IconNames.Duck)
    }
    
    //  Pack the data
    let message_to_send = control.createBuffer(18)
    message_to_send.fill(1)
    message_to_send[0] = DEVICE_ID
    message_to_send[1] = datatype.charCodeAt(0)
    message_to_send.setNumber(NumberFormat.Float32LE, 2, value)
    radio.sendBuffer(encrypt_message(message_to_send))
    //  Encrypted
    serial.writeLine(buffer_to_str(message_to_send) + ":sent")
    basic.clearScreen()
}

//  For an incoming message with id and type, check if we have reject_seen_recently
//  seen a message like it, and update the list as needed
//  Return 0 if we should not forward this message, 1 if we should forward.
function check_last_message_time(received_device_id: number, received_value_type: string): number {
    let running_time: number;
    let remove_idx: number;
    
    serial.writeLine("# Checking for last recieved time (limit " + ("" + TX_FLOOD_CONTROL_MS) + ") for device_id " + ("" + received_device_id) + " and type " + received_value_type)
    for (let received_message of received_messages) {
        if (received_message.includes("" + ("" + received_device_id) + ":" + received_value_type + "=")) {
            serial.writeLine("# Found matching previous id+type: " + received_message)
            message_received_time = get_message_received_time(received_message)
            running_time = input.runningTime()
            time_since_message = running_time - message_received_time
            if (time_since_message < TX_FLOOD_CONTROL_MS) {
                serial.writeLine("# Very recent match, current time was " + ("" + running_time) + " and time since msg " + ("" + time_since_message))
                return 0
            } else {
                serial.writeLine("# Only an old match, removing it and forwarding")
                remove_idx = _py.py_array_index(received_messages, received_message)
                if (remove_idx < 0) {
                    serial.writeLine("# INTERNAL ERROR: Didn't find line to remove!")
                }
                
                received_messages.removeAt(remove_idx)
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
    if (!(32 <= charcode && charcode <= 126)) {
        serial.writeLine("# Error, rejecting message due to non-ASCII buffer type (outside 32-126), likely decrypt failure, charcode: " + ("" + charcode))
        return true
    }
    
    //  Reject messages of type different a small group
    if (["t", "h", "c", "v", "n", "a", "b", "c"].indexOf(get_message_value_type(receivedBuffer)) < 0) {
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
    for (let i = 6; i < 18; i++) {
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
    
    if ([0, 1].indexOf(verbosity_level) >= 0) {
        basic.showIcon(IconNames.SmallDiamond)
    }
    
    serial.writeString(`# Decoding buffer:
# `)
    for (let i = 0; i < receivedBuffer.length; i++) {
        serial.writeString("" + receivedBuffer[i] + " ")
    }
    serial.writeLine("")
    if (is_message_bad(receivedBuffer)) {
        
    } else {
        //  Extract device ID and value type from the incoming data
        received_message_device_id = get_message_device_id(receivedBuffer)
        received_message_value_type = get_message_value_type(receivedBuffer)
        //  Check if its our own data coming back to us
        if (true || DEVICE_ID != received_message_device_id) {
            //  Check whether we've recently seen this data
            if (check_last_message_time(received_message_device_id, received_message_value_type) == 1) {
                received_messages.push("" + received_message_device_id + ":" + received_message_value_type + "=" + ("" + input.runningTime()))
                //  Tiny random pause before forwarding, to reduce collision odds
                basic.pause(randint(0, 100))
                //  Append my own device ID to the message
                append_forwarded_device_id(receivedBuffer)
                //  Send off the message again
                radio.sendBuffer(encrypt_message(receivedBuffer))
                //  Encrypted
                serial.writeLine(buffer_to_str(receivedBuffer) + ":forward")
                if ([0, 1].indexOf(verbosity_level) >= 0) {
                    basic.showIcon(IconNames.Yes)
                }
                
            } else {
                serial.writeLine(buffer_to_str(receivedBuffer) + ":reject_seen_recently")
                if ([0, 1].indexOf(verbosity_level) >= 0) {
                    basic.showIcon(IconNames.No)
                }
                
            }
            
        } else {
            serial.writeLine(buffer_to_str(receivedBuffer) + ":reject_own_id")
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
function buffer_to_str(buf: Buffer) {
    let forwarded_device_id: number;
    let buffer_device_id = get_message_device_id(buf)
    let buffer_type = get_message_value_type(buf)
    let buffer_value = buf.getNumber(NumberFormat.Float32LE, 2)
    let buffer_sent_via = " "
    for (let i = 6; i < 18; i++) {
        if (buf[i] == 0) {
            break
        }
        
        forwarded_device_id = buf.getNumber(NumberFormat.Int8LE, i)
        buffer_sent_via += "|" + ("" + forwarded_device_id)
    }
    return "" + buffer_device_id + ":" + ("" + buffer_type) + ":" + ("" + buffer_value) + buffer_sent_via
}

// radio.on_received_string(on_received_string) # Unencrypted
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

//  Split out the recieved time from <id>:<type>=<timestamp>
function get_message_received_time(message: string): number {
    try {
        return parseInt(_py.py_string_split(message, "=")[1])
    }
    catch (_) {
        return 0
    }
    
}

//  Initial setup and ID print
let FAILURE_VALUE = -999
let verbosity_level = 0
let received_message_value_type = ""
let received_message_device_id = -1
let time_since_message = 0
let message_received_time = 0
let received_messages : string[] = []
led.setBrightness(128)
radio.setGroup(194)
radio.setTransmitPower(7)
serial.writeLine("# Powered on, with ID: " + ("" + DEVICE_ID))
let TX_INTERVAL_MS = 10 * 60 * 1000
let TX_FLOOD_CONTROL_MS = Math.trunc(TX_INTERVAL_MS * 0.9)
basic.showString("ID " + ("" + DEVICE_ID))
// basic.show_icon(IconNames.SQUARE)
// basic.show_string("Temp")
basic.clearScreen()
//  Keep printing the current temp
basic.forever(function on_forever_show_screen() {
    if ([0, 2].indexOf(verbosity_level) >= 0) {
        basic.showNumber(read_temp())
    }
    
    basic.pause(5000)
})
//  Keep sending out the temperature
basic.forever(function on_forever_send() {
    basic.pause(TX_INTERVAL_MS)
    send_message("t", read_temp())
})
