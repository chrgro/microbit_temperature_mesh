//  Function to retrieve the temperature
//  In the future, expand this to read from an external set_transmit_power
//  instead of the internal microbit sensor
function read_temp(): number {
    return input.temperature()
}

//  From a message <id>:<type>:<value>, extract the
//  device id
function Get_message_device_id(message: string): number {
    return parseInt(_py.py_string_split(message, ":")[0])
}

//  On press button A, force a value send
input.onButtonPressed(Button.A, function on_button_pressed_a() {
    Send_message("t", read_temp())
})
//  Wrapper function to send messages out on BLE
function Send_message(Type: string, value: number) {
    
    basic.showIcon(IconNames.Duck)
    message_to_send = "" + ("" + device_id) + ":" + Type + ":" + ("" + value)
    radio.sendString(message_to_send)
    serial.writeLine("" + message_to_send + ":sent")
    basic.clearScreen()
}

//  For an incoming message with id and type, check if we have reject_seen_recently
//  seen a message like it, and update the list as needed
//  Return 0 if we should not forward this message, 1 if we should forward.
function Check_last_message_time(received_device_id: number, received_value_type: string): number {
    let running_time: number;
    
    serial.writeLine("# Checking for last recieved time for device_id" + ("" + received_device_id) + " and type " + received_value_type)
    for (let received_message of received_messages) {
        if (received_message.includes("" + ("" + received_device_id) + ":" + received_value_type + "=")) {
            serial.writeLine("# Found matching previous id+type: " + received_message)
            message_received_time = Get_message_received_time(received_message)
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
    return 1
}

//  Callback function on recieved wireless data
radio.onReceivedString(function on_received_string(receivedString: string) {
    
    basic.showIcon(IconNames.SmallDiamond)
    //  Extract device ID and value type from the incoming data
    received_message_device_id = Get_message_device_id(receivedString)
    received_message_value_type = Get_message_value_type(receivedString)
    //  Check if its our own data coming back to us
    if (device_id != received_message_device_id) {
        //  Check whether we've recently seen this data
        if (Check_last_message_time(received_message_device_id, received_message_value_type) == 1) {
            received_messages.push("" + received_message_device_id + ":" + received_message_value_type + "=" + ("" + input.runningTime()))
            radio.sendString(receivedString)
            serial.writeLine("" + receivedString + ":forward")
            basic.showIcon(IconNames.Yes)
        } else {
            serial.writeLine("" + receivedString + ":reject_seen_recently")
            basic.showIcon(IconNames.No)
        }
        
    } else {
        serial.writeLine("" + receivedString + ":reject_own_id")
        basic.showIcon(IconNames.No)
    }
    
    basic.clearScreen()
})
//  Split out the type from <id>:<type>:<value>
function Get_message_value_type(message2: string): string {
    return _py.py_string_split(message2, ":")[1]
}

//  Split out the recieved time from <id>:<type>=<timestamp>
function Get_message_received_time(message3: string): number {
    return parseInt(_py.py_string_split(message3, "=")[1])
}

//  Initial setup and ID print
let device_id = 2
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
serial.writeLine("# Powered on, with ID: " + ("" + device_id))
basic.showString("ID " + ("" + device_id))
basic.showIcon(IconNames.Square)
basic.showString("Temp")
basic.clearScreen()
//  Keep printing the current temp
basic.forever(function on_forever() {
    basic.showNumber(read_temp())
    basic.pause(5000)
})
//  Keep sending out the temperature
basic.forever(function on_forever2() {
    basic.pause(600000)
    Send_message("t", read_temp())
})
