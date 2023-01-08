# DEVICE ID
# CHANGE FOR EVERY NEW DEVICE!
DEVICE_ID = 2

# Function to retrieve the temperature
# In the future, expand this to read from an external set_transmit_power
# instead of the internal microbit sensor
def read_temp():
    return input.temperature()

# Encryption key, must be 19 bytes
key = bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    
def encrypt_message(message: str):
    padded_message = str(" "+message+"                   ")
    ciphertext = bytearray(19)
    iv = randint(0, 255)
    mod_v = iv
    for i in range(len(key)):
        char = padded_message.char_code_at(i)
        ciphertext[i] = (char ^ mod_v) ^ key[i]
        mod_v = ciphertext[i]
    return ciphertext

def decrypt_message(message: Buffer):
    padded_plaintext = ""
    # 19 bytes + NULL for string termination
    padded_plain_buffers = bytearray(19)
    mod_v = message[0]
    for i in range(len(key)):
        decrypted = (message[i] ^ mod_v) ^ key[i]
        #serial.write_line("Ciphertext "+ str(message[i])+" mod_v "+str(mod_v)+ " key "+key[i])
        padded_plain_buffers[i] = decrypted
        #serial.write_line("decrypted single: "+str(decrypted) + " decrypted arr: "+ str(padded_plain_buffers[i]))

        mod_v = message[i]
        pass
    s = padded_plain_buffers.to_string()
    #serial.write_line("Full string: "+s)
    return str(s)[1:].strip()


# From a message <id>:<type>:<value>, extract the
# device id
# Return ID 0 on any errors
# Accept only IDs between 1 and 99
def get_message_device_id(message: str):
    try:
        t = parseInt(message.split(":")[0])
        if not (0 < t < 100):
            return 0
        return t
    except:
        return 0

# On press button A, force a value send
def on_button_pressed_a():
    send_message("t", read_temp())
input.on_button_pressed(Button.A, on_button_pressed_a)

# On press button B, change how much is shown on screen
def on_button_pressed_b():
    # 0: Show everything (current temp + radio events)
    # 1: Only show radio events, don't show current temp
    # 2: Only show current temp, don't show radio events
    # 3: Keep the screen clear
    global verbosity_level
    verbosity_level = (verbosity_level + 1) % 4
    if verbosity_level == 0:
        basic.show_string("SHOW ALL")
    elif verbosity_level == 1:
        basic.show_string("RADIO ONLY")
    elif verbosity_level == 2:
        basic.show_string("TEMP ONLY")
    elif verbosity_level == 3:
        basic.show_string("QUIET")
input.on_button_pressed(Button.B, on_button_pressed_b)


# Wrapper function to send messages out on BLE
def send_message(Type: str, value: number):
    global message_to_send
    if verbosity_level in [0, 1]:
        basic.show_icon(IconNames.DUCK)
    message_to_send = "" + str(DEVICE_ID) + ":" + Type + ":" + str(value)
    #radio.send_string(message_to_send)
    radio.send_buffer(encrypt_message(message_to_send))
    serial.write_line("" + message_to_send + ":sent")
    basic.clear_screen()

# For an incoming message with id and type, check if we have reject_seen_recently
# seen a message like it, and update the list as needed
# Return 0 if we should not forward this message, 1 if we should forward.
def check_last_message_time(received_device_id: number, received_value_type: str):
    global message_received_time, time_since_message
    serial.write_line("# Checking for last recieved time for device_id " + str(received_device_id) + " and type "+received_value_type)
    for received_message in received_messages:
        if received_message.includes("" + str(received_device_id) + ":" + received_value_type + "="):
            serial.write_line("# Found matching previous id+type: " + received_message)

            message_received_time = get_message_received_time(received_message)
            running_time = input.running_time() 
            time_since_message = running_time - message_received_time
            if time_since_message < 540000:
                serial.write_line("# Very recent match, current time was " + str(running_time) +" and time since msg "+str(time_since_message))
                return 0
            else:
                serial.write_line("# Only an old match, removing it and forwarding")
                received_messages.remove_at(received_messages.index(received_message))
                return 1
    serial.write_line("# Found no previous match of this id+type")
    return 1

# Filter bad messages
def is_message_bad(receivedString : str):
    # Reject any non-ASCII messages
    for c in receivedString:
        charcode = c.char_code_at(0)
        if not (32 <= charcode <= 126):
            serial.write_line("# Error, rejecting message due to non-ASCII char (outside 32-126), likely decrypt failure, charcode: "+str(charcode))
            return True

    parts = receivedString.split(":")
    # Reject any msg without 3 parts
    if len(parts) != 3:
        serial.write_line("# Error, rejecting message for not having 3 ':' separated parts: "+receivedString)
        return True

    # Reject messages of type different a small group
    if parts[1] not in ["t", "h", "c", "v", "n", "a", "b", "c"]:
        serial.write_line("# Error, rejecting message not having an expected type "+receivedString)
        return True

    # Reject messages that hit the throw condition, i.e. its not a valid number
    if Get_message_value(receivedString) == FAILURE_VALUE:
        serial.write_line("# Error, rejecting message not having a number value "+receivedString)
        return True

    return False

# Callback function on recieved wireless data
def on_received_string(receivedString : str):
    global received_message_device_id, received_message_value_type, verbosity_level
    if verbosity_level in [0, 1]:
        basic.show_icon(IconNames.SMALL_DIAMOND)

    if is_message_bad(receivedString):
        pass
    else:
        # Extract device ID and value type from the incoming data
        received_message_device_id = get_message_device_id(receivedString)
        received_message_value_type = get_message_value_type(receivedString)
        # Check if its our own data coming back to us
        if DEVICE_ID != received_message_device_id:
            # Check whether we've recently seen this data
            if check_last_message_time(received_message_device_id, received_message_value_type) == 1:
                received_messages.append("" + received_message_device_id + ":" + received_message_value_type + "=" + str(input.running_time()))
                #radio.send_string(receivedString)
                radio.send_buffer(encrypt_message(receivedString))
                serial.write_line("" + receivedString + ":forward")
                if verbosity_level in [0, 1]:
                    basic.show_icon(IconNames.YES)
            else:
                serial.write_line("" + receivedString + ":reject_seen_recently")
                if verbosity_level in [0, 1]:
                    basic.show_icon(IconNames.NO)
        else:
            serial.write_line("" + receivedString + ":reject_own_id")
            if verbosity_level in [0, 1]:
                basic.show_icon(IconNames.NO)
    basic.clear_screen()
#radio.on_received_string(on_received_string)

def on_received_buffer(receivedBuffer):
    decrypted_msg = decrypt_message(receivedBuffer)
    on_received_string(decrypted_msg)

radio.on_received_buffer(on_received_buffer)

# Split out the type from <id>:<type>:<value>
def get_message_value_type(message: str):
    try:
        return message.split(":")[1]
    except:
        # This is after validation of message types, should
        # in theory this should be unreachable
        return "bad_type"

# Split out the value from <id>:<type>:<value>
def Get_message_value(message: str):
    try:
        v = parseInt(message.split(":")[2])
        return v
    except:
        return FAILURE_VALUE

# Split out the recieved time from <id>:<type>=<timestamp>
def get_message_received_time(message3: str):
    try:
        return int(message3.split("=")[1])
    except:
        return 0

# Initial setup and ID print
FAILURE_VALUE = -999
verbosity_level = 0
received_message_value_type = ""
received_message_device_id = -1
time_since_message = 0
message_received_time = 0
message_to_send = ""
received_messages: List[str] = []
led.set_brightness(128)
radio.set_group(194)
radio.set_transmit_power(7)
serial.write_line("# Powered on, with ID: "+  str(DEVICE_ID))

basic.show_string("ID " + str(DEVICE_ID))
basic.show_icon(IconNames.SQUARE)
basic.show_string("Temp")
basic.clear_screen()

# Keep printing the current temp
def on_forever_show_screen():
    if verbosity_level in [0, 2]:
        basic.show_number(read_temp())
    basic.pause(5000)
basic.forever(on_forever_show_screen)

# Keep sending out the temperature
def on_forever_send():
    basic.pause(600000)
    send_message("t", read_temp())
basic.forever(on_forever_send)
