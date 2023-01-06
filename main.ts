//  DEVICE ID
//  CHANGE FOR EVERY NEW DEVICE!
let DEVICE_ID = 4
//  Function to retrieve the temperature
//  In the future, expand this to read from an external set_transmit_power
//  instead of the internal microbit sensor
function read_temp(): number {
    return input.temperature()
}

//  From a message <id>:<type>:<value>, extract the
//  device id
//  Return ID 0 on any errors
//  Accept only IDs between 1 and 99
function get_message_device_id(message: string): number {
    let t: number;
    try {
        t = parseInt(_py.py_string_split(message, ":")[0])
        if (!(0 < t && t < 100)) {
            return 0
        }
        
        return t
    }
    catch (_) {
        return 0
    }
    
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
function send_message(Type: string, value: number) {
    
    if ([0, 1].indexOf(verbosity_level) >= 0) {
        basic.showIcon(IconNames.Duck)
    }
    
    message_to_send = "" + ("" + DEVICE_ID) + ":" + Type + ":" + ("" + value)
    radio.sendString(message_to_send)
    serial.writeLine("" + message_to_send + ":sent")
    basic.clearScreen()
}

//  For an incoming message with id and type, check if we have reject_seen_recently
//  seen a message like it, and update the list as needed
//  Return 0 if we should not forward this message, 1 if we should forward.
function check_last_message_time(received_device_id: number, received_value_type: string): number {
    let running_time: number;
    
    serial.writeLine("# Checking for last recieved time for device_id " + ("" + received_device_id) + " and type " + received_value_type)
    for (let received_message of received_messages) {
        if (received_message.includes("" + ("" + received_device_id) + ":" + received_value_type + "=")) {
            serial.writeLine("# Found matching previous id+type: " + received_message)
            message_received_time = get_message_received_time(received_message)
            running_time = input.runningTime()
            time_since_message = running_time - message_received_time
            if (time_since_message < 540000) {
                serial.writeLine("# Very recent match, current time was " + ("" + running_time) + " and time since msg " + ("" + time_since_message))
                return 0
            } else {
                serial.writeLine("# Only an old match, removing it and forwarding")
                received_messages.removeAt(_py.py_array_index(received_messages, received_message))
                return 1
            }
            
        }
        
    }
    serial.writeLine("# Found no previous match of this id+type")
    return 1
}

//  Filter bad messages
function is_message_bad(receivedString: string): boolean {
    let parts = _py.py_string_split(receivedString, ":")
    //  Reject any msg without 3 parts
    if (parts.length != 3) {
        serial.writeLine("# Error, rejecting message for not having 3 ':' separated parts: " + receivedString)
        return true
    }
    
    //  Reject messages of type different a small group
    if (["t", "h", "c", "v", "n", "a", "b", "c"].indexOf(parts[1]) < 0) {
        serial.writeLine("# Error, rejecting message not having an expected type " + receivedString)
        return true
    }
    
    //  Reject messages that hit the throw condition, i.e. its not a valid number
    if (Get_message_value(receivedString) == FAILURE_VALUE) {
        serial.writeLine("# Error, rejecting message not having a number value " + receivedString)
        return true
    }
    
    return false
}

//  Callback function on recieved wireless data
radio.onReceivedString(function on_received_string(receivedString: string) {
    
    if ([0, 1].indexOf(verbosity_level) >= 0) {
        basic.showIcon(IconNames.SmallDiamond)
    }
    
    if (is_message_bad(receivedString)) {
        
    } else {
        //  Extract device ID and value type from the incoming data
        received_message_device_id = get_message_device_id(receivedString)
        received_message_value_type = get_message_value_type(receivedString)
        //  Check if its our own data coming back to us
        if (DEVICE_ID != received_message_device_id) {
            //  Check whether we've recently seen this data
            if (check_last_message_time(received_message_device_id, received_message_value_type) == 1) {
                received_messages.push("" + received_message_device_id + ":" + received_message_value_type + "=" + ("" + input.runningTime()))
                radio.sendString(receivedString)
                serial.writeLine("" + receivedString + ":forward")
                if ([0, 1].indexOf(verbosity_level) >= 0) {
                    basic.showIcon(IconNames.Yes)
                }
                
            } else {
                serial.writeLine("" + receivedString + ":reject_seen_recently")
                if ([0, 1].indexOf(verbosity_level) >= 0) {
                    basic.showIcon(IconNames.No)
                }
                
            }
            
        } else {
            serial.writeLine("" + receivedString + ":reject_own_id")
            if ([0, 1].indexOf(verbosity_level) >= 0) {
                basic.showIcon(IconNames.No)
            }
            
        }
        
    }
    
    basic.clearScreen()
})
//  Split out the type from <id>:<type>:<value>
function get_message_value_type(message: string): string {
    try {
        return _py.py_string_split(message, ":")[1]
    }
    catch (_) {
        //  This is after validation of message types, should
        //  in theory this should be unreachable
        return "bad_type"
    }
    
}

//  Split out the value from <id>:<type>:<value>
function Get_message_value(message: string): number {
    let v: number;
    try {
        v = parseInt(_py.py_string_split(message, ":")[2])
        return v
    }
    catch (_) {
        return FAILURE_VALUE
    }
    
}

//  Split out the recieved time from <id>:<type>=<timestamp>
function get_message_received_time(message3: string): number {
    try {
        return parseInt(_py.py_string_split(message3, "=")[1])
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
let message_to_send = ""
let received_messages : string[] = []
received_messages = []
led.setBrightness(128)
radio.setGroup(1)
radio.setTransmitPower(7)
serial.writeLine("# Powered on, with ID: " + ("" + DEVICE_ID))
basic.showString("ID " + ("" + DEVICE_ID))
basic.showIcon(IconNames.Square)
basic.showString("Temp")
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
    basic.pause(600000)
    send_message("t", read_temp())
})
