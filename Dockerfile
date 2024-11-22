FROM python:3.13.0-slim

ADD main.py .

RUN pip install -U pip

RUN pip install -U discord-py-interactions pickledb pytz

CMD [ "python", "-u", "./main.py" ]