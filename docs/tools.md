# Python tools and interpreter library
## Where the tools are implemented

CaMeL implements the QLLM helper `query_ai_assistant`, the `AgentDojoFunction` bridge, capabilities annotations, security policies, and interpreter builtins. Business tools such as `send_email` are supplied by the installed **AgentDojo** dependency, not implemented as email-service connectors inside `src/camel`.

`main.py` loads AgentDojo suite version `v1.2`. `make_agentdojo_namespace` exposes every function in the supplied runtime; therefore the available tool list depends on runtime registration, not a fixed universal CaMeL list. The inventory below was read from all four installed v1.2 suites, without invoking any action tools.

See [agentdojo_function.py](../src/camel/pipeline_elements/agentdojo_function.py), [privileged_llm.py](../src/camel/pipeline_elements/privileged_llm.py), and [library.py](../src/camel/interpreter/library.py).

## CaMeL's QLLM tool

`query_ai_assistant(query, output_schema)` calls `query_quarantined_llm`, returning schema-validated data. It is registered by `PrivilegedLLM.query`. It is exempted from state-changing policy checks but its output still depends on its inputs in the Python interpreter.

The underlying QLLM helper checks `have_enough_information`; insufficient information raises `NotEnoughInformationError`. Validation is not proof of factual correctness or trusted provenance.

## Workspace tools (24)

| Tool | Description from the registered implementation |
|---|---|
| `send_email` | Sends an email with the given `body` to the given `address`. Returns a dictionary with the email details. |
| `delete_email` | Deletes the email with the given `email_id` from the inbox. |
| `get_unread_emails` | Returns all the unread emails in the inbox. Each email has a sender, a subject, and a body. |
| `get_sent_emails` | Returns all the sent emails in the inbox. Each email has a recipient, a subject, and a body. |
| `get_received_emails` | Returns all the received emails in the inbox. Each email has a sender, a subject, and a body. |
| `get_draft_emails` | Returns all the draft emails in the inbox. Each email has a recipient, a subject, and a body. |
| `search_emails` | Searches for emails in the inbox that contain the given query in the subject or body. If `address` is provided, |
| `search_contacts_by_name` | Finds contacts in the inbox's contact list by name. |
| `search_contacts_by_email` | Finds contacts in the inbox's contact list by email. |
| `get_current_day` | Returns the current day in ISO format, e.g. '2022-01-01'. |
| `search_calendar_events` | Searches calendar events that match the given query in the tile or the description. If provided, filters events by date. |
| `get_day_calendar_events` | Returns the appointments for the given `day`. Returns a list of dictionaries with informations about each meeting. |
| `create_calendar_event` | Creates a new calendar event with the given details and adds it to the calendar. |
| `cancel_calendar_event` | Cancels the event with the given `event_id`. The event will be marked as canceled and no longer appear in the calendar. |
| `reschedule_calendar_event` | Reschedules the event with the given `event_id` to the new start and end times. |
| `add_calendar_event_participants` | Adds the given `participants` to the event with the given `event_id`. |
| `append_to_file` | Append content to a file in the cloud drive. |
| `search_files_by_filename` | Get a file from a cloud drive by its filename. It returns a list of files. |
| `create_file` | Create a new file in the cloud drive. |
| `delete_file` | Delete a file from the cloud drive by its filename. |
| `get_file_by_id` | Get a file from a cloud drive by its ID. |
| `list_files` | Retrieve all files in the cloud drive. |
| `share_file` | Share a file with a user. |
| `search_files` | Search for files in the cloud drive by content. |

## Banking tools (11)

| Tool | Description from the registered implementation |
|---|---|
| `get_iban` | Get the IBAN of the current bank account. |
| `send_money` | Sends a transaction to the recipient. |
| `schedule_transaction` | Schedule a transaction. |
| `update_scheduled_transaction` | Update a scheduled transaction. |
| `get_balance` | Get the balance of the account. |
| `get_most_recent_transactions` | Get the list of the most recent transactions, e.g. to summarize the last n transactions. |
| `get_scheduled_transactions` | Get the list of scheduled transactions. |
| `read_file` | Reads the contents of the file at the given path. |
| `get_user_info` | Get the user information. |
| `update_password` | Update the user password. |
| `update_user_info` | Update the user information. |

## Travel tools (28)

| Tool | Description from the registered implementation |
|---|---|
| `get_user_information` | Get the user information, could be: first name, last name, ID number, email, phone number, address, passport number, bank account number, credit card number. These information are used for booking hotels, restaurants, car rentals, and flights. |
| `get_all_hotels_in_city` | Get all hotels in the given city. |
| `get_hotels_prices` | Get all hotels within the given budget, should be within the price range. |
| `get_rating_reviews_for_hotels` | Get the rating and reviews for the given hotels. |
| `get_hotels_address` | Get the address of the given hotel. |
| `get_all_restaurants_in_city` | Get all restaurants in the given city. |
| `get_cuisine_type_for_restaurants` | Get the cuisine type of the given restaurants, could be: Italian, Chinese, Indian, Japanese. |
| `get_restaurants_address` | Get the address of the given restaurants. |
| `get_rating_reviews_for_restaurants` | Get the rating and reviews for the given restaurants. |
| `get_dietary_restrictions_for_all_restaurants` | Get the dietary restrictions of the given restaurants, could be: Vegetarian, Vegan, Gluten-free, Dairy-free. |
| `get_contact_information_for_restaurants` | Get the contact information of the given restaurants. |
| `get_price_for_restaurants` | Get the price per person of the given restaurants. |
| `check_restaurant_opening_hours` | Get the openning hours of the given restaurants, check if the restaurant is open. |
| `get_all_car_rental_companies_in_city` | Get all car rental companies in the given city. |
| `get_car_types_available` | Get the car types available for the given car rental companies. |
| `get_rating_reviews_for_car_rental` | Get the rating and reviews for the given car rental companies. |
| `get_car_fuel_options` | Get the fuel options of the given car rental companies. |
| `get_car_rental_address` | Get the address of the given car rental companies. |
| `get_car_price_per_day` | Get the price per day of the given car rental companies. |
| `create_calendar_event` | Creates a new calendar event with the given details and adds it to the calendar. |
| `search_calendar_events` | Searches calendar events that match the given query in the tile or the description. If provided, filters events by date. |
| `get_day_calendar_events` | Returns the appointments for the given `day`. Returns a list of dictionaries with informations about each meeting. |
| `cancel_calendar_event` | Cancels the event with the given `event_id`. The event will be marked as canceled and no longer appear in the calendar. |
| `reserve_hotel` | Makes a reservation for a hotel with the provided details.. |
| `reserve_car_rental` | Makes a reservation for a car rental with the provided details. |
| `reserve_restaurant` | Makes a reservation for a restaurant with the provided details. |
| `get_flight_information` | Get the flight information from the departure city to the arrival city. |
| `send_email` | Sends an email with the given `body` to the given `address`. Returns a dictionary with the email details. |

## Slack tools (11)

| Tool | Description from the registered implementation |
|---|---|
| `get_channels` | Get the list of channels in the slack. |
| `add_user_to_channel` | Add a user to a given channel. |
| `read_channel_messages` | Read the messages from the given channel. |
| `read_inbox` | Read the messages from the given user inbox. |
| `send_direct_message` | Send a direct message from `author` to `recipient` with the given `content`. |
| `send_channel_message` | Send a channel message from `author` to `channel` with the given `content`. |
| `get_users_in_channel` | Get the list of users in the given channel. |
| `invite_user_to_slack` | Invites a user to the Slack workspace. |
| `remove_user_from_slack` | Remove a user from the Slack workspace. |
| `get_webpage` | Returns the content of the webpage at a given URL. |
| `post_webpage` | Posts a webpage at a given URL with the given content. |

## Python interpreter builtins

These are language helpers, not external action tools. The explicit library allowlist is:

`abs`, `any`, `all`, `bool`, `dir`, `divmod`, `enumerate`, `float`, `hash`, `int`, `len`, `list`, `max`, `min`, `print`, `range`, `repr`, `reversed`, `set`, `sorted`, `str`, `tuple`, `type`, `zip`, `sum`.

## Supported builtin methods

- `dict`: `get`, `items`, `keys`, `values`.
- `list`: `index`.
- `str`: `capitalize`, `count`, `endswith`, `find`, `format`, `index`, `isalnum`, `isalpha`, `isdigit`, `islower`, `isspace`, `istitle`, `isupper`, `join`, `lower`, `lstrip`, `partition`, `removeprefix`, `removesuffix`, `replace`, `rfind`, `rindex`, `rpartition`, `rsplit`, `rstrip`, `split`, `splitlines`, `startswith`, `strip`, `title`, `upper`.

## Registered classes and class methods

- `ValueError`: no registered methods.
- `NotEnoughInformationError`: no registered methods.
- `Enum`: no registered methods.
- `datetime`: `strftime`, `replace`, `isoformat`, `utcoffset`, `strptime`, `fromisoformat`, `date`, `time`, `weekday`, `combine`, `__add__`, `__sub__`.
- `timedelta`: `total_seconds`, `__add__`, `__sub__`, `__mul__`, `__truediv__`, `__radd__`, `__rsub__`, `__rmul__`.
- `date`: `replace`, `isoformat`, `strftime`, `fromisoformat`, `__add__`, `__radd__`, `__sub__`.
- `time`: `replace`, `isoformat`, `strftime`, `fromisoformat`.
- `timezone`: `utcoffset`, `tzname`, `dst`.
- `BaseModel`: `model_construct`, `model_copy`, `model_dump`, `model_dump_json`, `model_json_schema`, `model_parametrized_name`, `model_validate`, `model_validate_json`, `model_validate_strings`.
- `FieldInfo`: no registered methods.
- `EmailStr`: no registered methods.
- `NaiveDatetime`: no registered methods.

These classes can support structured QLLM results and date operations. Some date/time classes are filtered for non-workspace/non-travel tasks. Additional result types are derived from the runtime tool schemas. Python keywords and AST syntax are handled by the evaluator, not by this callable inventory.

## Actions, sources, and policy coverage

A tool being available does not imply that it is approved for every argument. Domain `no_side_effect_tools` sets exempt read operations; domain `policies` lists govern other calls. Output annotations determine trust and reader permissions separately. Consult [policies and enforcement](policies-and-enforcement.md) for the gate and its exceptions.

## JavaScript migration

None of these Python runtime bindings are automatically injected into the current Node process. The inventory describes the Python integration and what a JavaScript bridge would need to expose. The Semgrep rule recognizes some tool names syntactically; it does not implement the tools.
