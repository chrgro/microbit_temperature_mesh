# DEVICE ID
# CHANGE FOR EVERY NEW DEVICE!
DEVICE_ID = 15

# Encryption key, must be 19 bytes
key = bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

AHTX0_I2CADDR=0x38           # AHT default i2c address
AHTX0_CMD_CALIBRATE=0xE1     # Calibration command
AHTX0_CMD_SOFTRESET=0xBA     # Soft reset command
AHTX0_STATUS_BUSY=0x80       # Status bit for busy
AHTX0_STATUS_CALIBRATED=0x08 # Status bit for calibrated

def ahtx0_get_status():
    return pins.i2c_read_number(AHTX0_I2CADDR, NumberFormat.UINT8_LE, False)

def init_ahtx0():
    serial.write_line("# AHT sensor reset and calibration...")
    # Reset AHT
    pins.i2c_write_number(AHTX0_I2CADDR, AHTX0_CMD_SOFTRESET, NumberFormat.INT8_LE, False)
    control.wait_micros(20000)

    cmd = Buffer.create(3)
    cmd.set_uint8(0, AHTX0_CMD_CALIBRATE)
    cmd.set_uint8(1, 0x08)
    cmd.set_uint8(2, 0x00)
    pins.i2c_write_buffer(AHTX0_I2CADDR, cmd, False)

    while(ahtx0_get_status() & AHTX0_STATUS_BUSY):
        control.wait_micros(10000)
        serial.write_line("# AHT sensor not ready")
    control.wait_micros(10000)
    if (ahtx0_get_status() & AHTX0_STATUS_CALIBRATED):
        serial.write_line("# AHT sensor calibrated")
    else:
        serial.write_line("# AHT sensor NOT calibrated!!")

def ahtx0_get_data():
    cmd = Buffer.create(3)
    cmd.set_number(NumberFormat.UINT8_LE, 0, 0xAC)
    cmd.set_number(NumberFormat.UINT8_LE, 1, 0x33)
    cmd.set_number(NumberFormat.UINT8_LE, 2, 0x00)
    pins.i2c_write_buffer(AHTX0_I2CADDR, cmd)
    control.wait_micros(90000)
    while(ahtx0_get_status() & AHTX0_STATUS_BUSY):
        control.wait_micros(20000)
        serial.write_line("# Sensor should not take so long time...")
    readbuf = pins.i2c_read_buffer(AHTX0_I2CADDR, 6, False)

    h = readbuf.get_number(NumberFormat.UINT8_LE, 1)
    h <<= 8
    h |= readbuf.get_number(NumberFormat.UINT8_LE, 2)
    h <<= 4
    h |= (readbuf.get_number(NumberFormat.UINT8_LE, 3) >> 4)
    humidity = (h*100.0) / 0x100000
    serial.write_string("# Humidity: ")
    serial.write_number(humidity)

    t = (readbuf.get_number(NumberFormat.UINT8_LE, 3) & 0x0F)
    t <<= 8
    t |= readbuf.get_number(NumberFormat.UINT8_LE, 4)
    t <<= 8
    t |= readbuf.get_number(NumberFormat.UINT8_LE, 5)
    temperature = ((t / 0x100000) * 200.0) - 50;
    serial.write_string(" Temperature: ")
    serial.write_number(temperature)
    serial.write_line("")
    return (temperature, humidity)

# Function to retrieve the temperature
# In the future, expand this to read from an external set_transmit_power
# instead of the internal microbit sensor
def read_temp_humidity():
    i2c_aht_temp = True
    i2c_temp = False

    if i2c_aht_temp:
        temperature, humidity = ahtx0_get_data()
        return temperature, humidity
    elif i2c_temp:
        raw_value = pins.i2c_read_number(0x48, NumberFormat.INT16_BE, False)
        # Reduce to just 2 subfractional bits (i.e. 0.25 C resolution)
        #truncated_value = raw_value & 0xffC0
        temp = raw_value * 0.00390625  # divide by 256
        return temp , -1
    else:
        return input.temperature(), -1


# Encryption is a simple XOR, with keysize equal to datasize,
# 19 bytes. This is equally safe as any other block cipher.
# The block mode is CBC, with an 8 bit block size and thus
# 8 bit initialization vector (IV). It at least reduces the odds
# of repeat messages, but there will be some of them (every 256th
# message with the same plaintext will then have same ciphertext).
# We could use a bigger block size, the code just gets a tiny bit
# more complicated and we lose plaintext capacity.
def encrypt_message(message: Buffer):
    ciphertext = bytearray(19)
    iv = randint(0, 255)
    mod_v = iv
    for i in range(len(ciphertext)):
        # Pad message with a slot of IV, and enough spaces
        # on the end to always make it at least 19 bytes.
        if i == 0 or (i-1) >= len(message):
            char = 0
        else:
            char = message[i-1]
        ciphertext[i] = (char ^ mod_v) ^ key[i]
        mod_v = ciphertext[i]
    return ciphertext

def decrypt_message(message: Buffer):
    # 19 bytes for the buffer
    padded_plain_buffers = bytearray(19)
    mod_v = message[0]
    for i in range(len(key)):
        decrypted = (message[i] ^ mod_v) ^ key[i]
        padded_plain_buffers[i] = decrypted
        mod_v = message[i]
    return padded_plain_buffers[1:]


# On press button A, force a value send
def on_button_pressed_a():
    temp, humidity = read_temp_humidity()
    send_message("t", temp)
    if humidity >= 0:
        send_message("h", humidity)
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
def send_message(datatype: str, value: number):
    if verbosity_level in [0, 1]:
        basic.show_icon(IconNames.DUCK)

    # Pack the data
    message_to_send = bytearray(18)
    message_to_send.fill(0)
    message_to_send[0] = DEVICE_ID
    message_to_send[1] = datatype.char_code_at(0)
    message_to_send.setNumber(NumberFormat.FLOAT32_LE, 2, value)

    radio.send_buffer(encrypt_message(message_to_send)) # Encrypted
    serial.write_line(buffer_to_json(message_to_send, "sent"))
    basic.clear_screen()

# For an incoming message with id and type, check if we have reject_seen_recently
# seen a message like it, and update the list as needed
# Return 0 if we should not forward this message, 1 if we should forward.
def check_last_message_time(received_device_id: number, received_value_type: str):
    global received_messages
    serial.write_line("# Checking for last recieved time (limit "+str(TX_FLOOD_CONTROL_MS)+") for device_id " + str(received_device_id) + " and type "+received_value_type)
    for i in range(len(received_messages)):
        prev_seen_message : Buffer = received_messages[i]
        if get_message_device_id(prev_seen_message) == received_device_id and get_message_value_type(prev_seen_message) == received_value_type:
            message_received_time = get_message_received_time(prev_seen_message)
            running_time = input.running_time()
            time_since_message = running_time - message_received_time
            if 0 < time_since_message < TX_FLOOD_CONTROL_MS:
                serial.write_line("# Very recent match, current time was " + str(running_time) +" and time since msg "+str(time_since_message))
                return 0
            else:
                serial.write_line("# Only an old match, removing it and forwarding")
                received_messages.remove_at(i)
                return 1
    serial.write_line("# Found no previous match of this id+type")
    return 1

# Filter bad messages
def is_message_bad(receivedBuffer : Buffer):
    # Reject any non-ASCII messages
    datatype = get_message_value_type(receivedBuffer)
    charcode = datatype.char_code_at(0)
    # Check for valid ascii in buffer type field and last byte equals to 0
    if not (32 <= charcode <= 126) or receivedBuffer[17] != 0:
        serial.write_line("# Error, rejecting message due to likely decrypt failure, charcode: "+str(charcode))
        return True

    # Reject messages of type different a small group
    if get_message_value_type(receivedBuffer) not in ["t", "h", "c", "v", "n", "a", "b", "c"]:
        serial.write_line("# Error, rejecting message not having an expected type :"+get_message_value_type(receivedBuffer))
        return True

    # Reject messages that hit the throw condition, i.e. its not a valid number
    if get_message_value(receivedBuffer) == FAILURE_VALUE:
        serial.write_line("# Error, rejecting message not having a valid floating point ")
        return True

    return False

# Append own device ID to forwarded message
def append_forwarded_device_id(messageBuffer: Buffer):
    # Loop all bytes to look for the first free location
    for i in range(6, 17):
        if messageBuffer[i] == 0:
            messageBuffer[i] = DEVICE_ID
            return
    # If there are no free slots, just keep the buffer unchanged
    return

# Callback function on recieved wireless data
def decode_buffer(receivedBuffer : Buffer):
    global verbosity_level
    if verbosity_level in [0, 1]:
        basic.show_icon(IconNames.SMALL_DIAMOND)

    ## DEBUG PRINT
    #serial.write_string("# Decoding buffer:\n# ")
    #for i in range(receivedBuffer.length):
    #    serial.write_string(str(receivedBuffer[i]) + " ")
    #serial.write_line("")

    if is_message_bad(receivedBuffer):
        pass
    else:
        # Extract device ID and value type from the incoming data
        received_message_device_id = get_message_device_id(receivedBuffer)
        received_message_value_type = get_message_value_type(receivedBuffer)
        # Check if its our own data coming back to us
        if DEVICE_ID != received_message_device_id:
            # Check whether we've recently seen this data
            if check_last_message_time(received_message_device_id, received_message_value_type) == 1:
                last_seen = bytearray(6)
                last_seen.setNumber(NumberFormat.INT8_LE, 0, received_message_device_id)
                last_seen[1] = received_message_value_type.char_code_at(0)
                last_seen.setNumber(NumberFormat.FLOAT32_LE, 2, input.running_time())
                received_messages.append(last_seen)
                # Tiny random pause before forwarding, to reduce collision odds
                basic.pause(randint(0, 100))
                # Append my own device ID to the message
                append_forwarded_device_id(receivedBuffer)
                # Send off the message again
                radio.send_buffer(encrypt_message(receivedBuffer)) # Encrypted
                serial.write_line(buffer_to_json(receivedBuffer, "forward"))
                if verbosity_level in [0, 1]:
                    basic.show_icon(IconNames.YES)
            else:
                serial.write_line(buffer_to_json(receivedBuffer, "reject_seen_recently"))
                if verbosity_level in [0, 1]:
                    basic.show_icon(IconNames.NO)
        else:
            serial.write_line(buffer_to_json(receivedBuffer, "reject_own_id"))
            if verbosity_level in [0, 1]:
                basic.show_icon(IconNames.NO)
    basic.clear_screen()

# Buffer layout:
# Byte 0: device id
# Byte 1: Data type
# Byte 2-5: value
# Byte 6-16: device id of forwarding nodes
# Byte 17: Either 0 or ascii > if we ran out of space
def buffer_to_json(buf : Buffer, action : str):
    buffer_device_id = get_message_device_id(buf)
    buffer_type = get_message_value_type(buf)
    buffer_value = buf.get_number(NumberFormat.FLOAT32_LE, 2)
    buffer_sent_via = "[ "
    for i in range(6, 18):
        if buf[i] == 0:
            break
        forwarded_device_id = buf.get_number(NumberFormat.INT8_LE, i)
        buffer_sent_via += str(forwarded_device_id)+","
    buffer_sent_via = buffer_sent_via[:-1]+"]"
    retstr = '{"device_id":'+str(buffer_device_id)+','
    retstr += '"type": "'+str(buffer_type)+'",'
    retstr += '"value": '+str(buffer_value)+','
    retstr += '"forwarded_via":'+buffer_sent_via+','
    retstr += '"action_taken": "'+action+'"'
    retstr += '}'
    return retstr


def on_received_buffer(receivedBuffer):
    decrypted_msg = decrypt_message(receivedBuffer)
    decode_buffer(decrypted_msg)

radio.on_received_buffer(on_received_buffer) # Encrypted

# Split out the type from <id>:<type>:<value>
def get_message_value_type(message: Buffer):
    try:
        single_byte = bytearray(1)
        single_byte[0] = message[1]
        type_str = single_byte.to_string()
        return type_str
    except:
        # This is after validation of message types, should
        # in theory this should be unreachable
        return "bad_type"

# From a message buffer, extract the
# device id
# Return ID 0 on any errors
# Accept only IDs between 1 and 99
def get_message_device_id(message: Buffer):
    try:
        t = message.get_number(NumberFormat.INT8_LE, 0)
        if not (0 < t < 100):
            return 0
        return t
    except:
        return 0

# Split out the value from <id>:<type>:<value>
def get_message_value(message: Buffer):
    try:
        v = message.get_number(NumberFormat.FLOAT32_LE, 2)
        return v
    except:
        return FAILURE_VALUE

# Split out the recieved time from the buffer
def get_message_received_time(prev_seen_message: Buffer):
    return prev_seen_message.getNumber(NumberFormat.FLOAT32_LE, 2)

# Initial setup and ID print
FAILURE_VALUE = -999
verbosity_level = 0
received_messages : List[Buffer] = []
led.set_brightness(128)
radio.set_group(181)
radio.set_transmit_power(7)
serial.write_line("# Powered on, with ID: "+  str(DEVICE_ID))

init_ahtx0()

TX_INTERVAL_MS = 10*60*1000
TX_FLOOD_CONTROL_MS = int(TX_INTERVAL_MS * 0.9)

basic.show_string("ID " + str(DEVICE_ID))
basic.show_icon(IconNames.SMALL_SQUARE)
basic.clear_screen()

# Keep printing the current temp
def on_forever_show_screen():
    if verbosity_level in [0, 2]:
        temp, humidity = read_temp_humidity()
        basic.show_number(Math.round_with_precision(temp, 1))
        basic.show_string("C ")
        if humidity >= 0:
            basic.pause(1000)
            basic.show_number(humidity)
            basic.show_string("%")

    basic.pause(8000)
basic.forever(on_forever_show_screen)

# Keep sending out the temperature
def on_forever_send():
    basic.pause(TX_INTERVAL_MS / 2)
    temp1, humidity1 = read_temp_humidity()
    send_message("t", temp1)
    basic.pause(TX_INTERVAL_MS / 2)
    temp2, humidity2 = read_temp_humidity()
    if humidity2 >= 0:
        send_message("h", humidity2)
basic.forever(on_forever_send)
