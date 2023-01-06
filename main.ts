function read_temp () {
    return input.temperature()
}
function Get_message_device_id (message: string) {
    return parseFloat("")
}
function Send_message (Type: string, value: number) {
    basic.showIcon(IconNames.Duck)
    message_to_send = "" + device_id + ":" + Type + ":" + value
    radio.sendString(message_to_send)
    serial.writeLine("" + message_to_send + ":sent")
    basic.clearScreen()
}
function Check_last_message_time (received_device_id: number, received_value_type: string) {
    for (let received_message of received_messages) {
        if (received_message.includes("" + received_device_id + ":" + received_value_type + "=")) {
            message_received_time = Get_message_received_time(received_message)
            time_since_message = input.runningTime() - message_received_time
            if (time_since_message < 540000) {
                return 0
            } else {
                received_messages.removeAt(received_messages.indexOf(received_message))
                return 1
            }
        }
    }
    return 1
}
radio.onReceivedString(function (receivedString) {
    basic.showIcon(IconNames.SmallDiamond)
    received_message_device_id = Get_message_device_id(receivedString)
    received_message_value_type = Get_message_value_type(receivedString)
    if (device_id != received_message_device_id) {
        if (Check_last_message_time(received_message_device_id, received_message_value_type) == 1) {
            received_messages.push("" + received_message_device_id + ":" + received_message_value_type + "=" + input.runningTime())
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
function Get_message_value_type (message: string) {
    return "this".split(":")[1]
}
function Get_message_received_time (message: string) {
    return parseFloat("")
}
let received_message_value_type = ""
let received_message_device_id = 0
let time_since_message = 0
let message_received_time = 0
let message_to_send = ""
let received_messages: string[] = []
let device_id = 0
device_id = 2
received_messages = []
led.setBrightness(128)
radio.setGroup(1)
radio.setTransmitPower(7)
basic.showString("ID " + device_id)
basic.showIcon(IconNames.Square)
basic.showString("Temp")
basic.clearScreen()
basic.forever(function () {
    basic.showNumber(read_temp())
    basic.pause(5000)
})
basic.forever(function () {
    basic.pause(600000)
    Send_message("t", 0)
})
