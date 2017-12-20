build:
	docker build -t dserve .

run:
	docker run -it --rm -p 80:3000 -v /var/run/docker.sock:/var/run/docker.sock dserve

.PHONY: build