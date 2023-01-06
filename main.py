def Get_message_device_id(message: str):
    return parse_float(message.split(":")[0])
def Send_message(Type: str, value: number):
    global message_to_send
    basic.show_icon(IconNames.DUCK)
    message_to_send = "" + str(device_id) + ":" + Type + ":" + ("" + str(value))
    radio.send_string(message_to_send)
    basic.clear_screen()
def Check_last_message_time(received_device_id: number):
    global message_received_time, time_since_message
    for received_message in received_messages:
        if Get_message_device_id(received_message) == received_device_id:
            message_received_time = Get_message_received_time(received_message)
            time_since_message = input.running_time() - message_received_time
            if time_since_message < 540000:
                return 0
            else:
                received_messages.remove_at(received_messages.index(received_message))
                return 1
    return 1

def on_received_string(receivedString):
    global received_message_device_id
    basic.show_icon(IconNames.SMALL_DIAMOND)
    received_message_device_id = Get_message_device_id(receivedString)
    if device_id != received_message_device_id:
        if Check_last_message_time(received_message_device_id) == 1:
            basic.show_icon(IconNames.YES)
            received_messages.append("" + str(received_message_device_id) + ":" + str(input.running_time()))
            radio.send_string(receivedString)
        basic.show_icon(IconNames.NO)
    else:
        basic.show_icon(IconNames.NO)
    basic.clear_screen()
radio.on_received_string(on_received_string)

def Get_message_received_time(message: str):
    return parse_float(message.split(":")[1])
received_message_device_id = 0
time_since_message = 0
message_received_time = 0
message_to_send = ""
received_messages: List[str] = []
device_id = 0
radio.set_group(1)
radio.set_transmit_power(7)
device_id = 1
received_messages = []

def on_forever():
    Send_message("t", input.temperature())
    basic.pause(600000)
basic.forever(on_forever)
