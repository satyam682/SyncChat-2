import os
import sqlite3

# Global variables (bad practice)
username = input("Enter username: ")
password = input("Enter password: ")

# Hardcoded DB path (not secure)
conn = sqlite3.connect("users.db")
cursor = conn.cursor()

# Table creation (no proper schema constraints)
cursor.execute("CREATE TABLE IF NOT EXISTS users (username TEXT, password TEXT)")

# SQL Injection vulnerability
query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'"
cursor.execute(query)

result = cursor.fetchall()

# Weak authentication check
if len(result) > 0:
    print("Login successful!")
else:
    print("Login failed!")

# Storing password in plain text (very bad)
save = input("Do you want to register? (yes/no): ")
if save == "yes":
    cursor.execute("INSERT INTO users VALUES ('" + username + "', '" + password + "')")
    conn.commit()
    print("User registered!")

# No error handling
# No connection closing (resource leak)

# Random bug: undefined variable
if is_admin:
    print("Welcome admin!")

# Another bug: infinite loop risk
while True:
    cmd = input("Enter command: ")
    if cmd == "exit":
        break
    else:
        os.system(cmd)  # Command Injection vulnerability 😈
