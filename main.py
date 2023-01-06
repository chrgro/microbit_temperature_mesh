 # Function to retrieve the temperature
# In the future, expand this to read from an external set_transmit_power
# instead of the internal microbit sensor
def read_temp():
    return input.temperature()

# From a message <id>:<type>:<value>, extract the
# device id
def Get_message_device_id(message: str):
    return int(message.split(":")[0])

# On press button A, force a value send
def on_button_pressed_a():
    Send_message("t", read_temp())
input.on_button_pressed(Button.A, on_button_pressed_a)

# Wrapper function to send messages out on BLE
def Send_message(Type: str, value: number):
    global message_to_send
    basic.show_icon(IconNames.DUCK)
    message_to_send = "" + str(device_id) + ":" + Type + ":" + str(value)
    radio.send_string(message_to_send)
    serial.write_line("" + message_to_send + ":sent")
    basic.clear_screen()

# For an incoming message with id and type, check if we have reject_seen_recently
# seen a message like it, and update the list as needed
# Return 0 if we should not forward this message, 1 if we should forward.
def Check_last_message_time(received_device_id: number, received_value_type: str):
    global message_received_time, time_since_message
    serial.write_line("# Checking for last recieved time for device_id" + str(received_device_id) + " and type "+received_value_type)
    for received_message in received_messages:
        if received_message.includes("" + str(received_device_id) + ":" + received_value_type + "="):
            serial.write_line("# Found matching previous id+type: " + received_message)

            message_received_time = Get_message_received_time(received_message)
            running_time = input.running_time() 
            time_since_message = running_time - message_received_time
            if time_since_message < 540000:
                serial.write_line("# Very recent match, current time was " + str(running_time) +" and time since msg "+str(time_since_message))
                return 0
            else:
                serial.write_line("# Only an old match, removing it and forwarding")
                received_messages.remove_at(received_messages.index(received_message))
                return 1
    return 1

# Callback function on recieved wireless data
def on_received_string(receivedString):
    global received_message_device_id, received_message_value_type
    basic.show_icon(IconNames.SMALL_DIAMOND)
    # Extract device ID and value type from the incoming data
    received_message_device_id = Get_message_device_id(receivedString)
    received_message_value_type = Get_message_value_type(receivedString)
    # Check if its our own data coming back to us
    if device_id != received_message_device_id:
        # Check whether we've recently seen this data
        if Check_last_message_time(received_message_device_id, received_message_value_type) == 1:
            received_messages.append("" + received_message_device_id + ":" + received_message_value_type + "=" + str(input.running_time()))
            radio.send_string(receivedString)
            serial.write_line("" + receivedString + ":forward")
            basic.show_icon(IconNames.YES)
        else:
            serial.write_line("" + receivedString + ":reject_seen_recently")
            basic.show_icon(IconNames.NO)
    else:
        serial.write_line("" + receivedString + ":reject_own_id")
        basic.show_icon(IconNames.NO)
    basic.clear_screen()
radio.on_received_string(on_received_string)

# Split out the type from <id>:<type>:<value>
def Get_message_value_type(message2: str):
    return message2.split(":")[1]

# Split out the recieved time from <id>:<type>=<timestamp>
def Get_message_received_time(message3: str):
    return int(message3.split("=")[1])

# Initial setup and ID print
device_id = 2

received_message_value_type = ""
received_message_device_id = -1
time_since_message = 0
message_received_time = 0
message_to_send = ""
received_messages: List[str] = []
received_messages = []
led.set_brightness(128)
radio.set_group(1)
radio.set_transmit_power(7)
serial.write_line("# Powered on, with ID: "+  str(device_id))

basic.show_string("ID " + str(device_id))
basic.show_icon(IconNames.SQUARE)
basic.show_string("Temp")
basic.clear_screen()

# Keep printing the current temp
def on_forever():
    basic.show_number(read_temp())
    basic.pause(5000)
basic.forever(on_forever)

# Keep sending out the temperature
def on_forever2():
    basic.pause(600000)
    Send_message("t", read_temp())
basic.forever(on_forever2)
